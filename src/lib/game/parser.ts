/**
 * Brindlewick Natural Language Parser
 *
 * Architecture decision: Two-tier parsing.
 *
 * Tier 1 — Regex/keyword matching. Fast, free, no latency. Handles >85% of
 * typical player inputs. The regex patterns are intentionally permissive —
 * "go to the bakery", "walk to bakery", "head toward the copper kettle" all
 * map to { intent: 'go', target: 'bakery' }.
 *
 * Tier 2 — Claude (claude-haiku). Invoked only when Tier 1 returns
 * intent:'unknown'. Haiku resolves ambiguous phrasing, complex questions, and
 * free-form natural language. Cost: ~$0.001 per query at haiku pricing — fine
 * for the small tail of unmatched inputs. Adds ~200-400ms latency when used.
 *
 * Why not Claude for everything? Latency and fragility. A pure-LLM parser adds
 * 300-800ms to every keypress-to-response cycle, and LLM outputs are
 * nondeterministic. The hybrid approach gives fast, predictable responses for
 * common commands with graceful fallback for creative phrasing.
 */

import { getAnthropicClient, MODEL } from '../anthropic/client'
import type { ParsedCommand, CommandIntent } from '../../types/game'

// ── Tier 1: Regex patterns ───────────────────────────────────────────────────

const INTENT_PATTERNS: Array<{ intent: CommandIntent; patterns: RegExp[] }> = [
  {
    intent: 'go',
    patterns: [
      /^(?:go|walk|head|move|travel|wander|step|enter|leave|exit|visit)\s+(?:to\s+|toward[s]?\s+|into\s+|towards\s+)?(.+)/i,
      /^(?:north|south|east|west|up|down|inside|outside|back|forward|in|out)$/i,
      /^(?:n|s|e|w|u|d)$/i,
    ],
  },
  {
    intent: 'look',
    patterns: [
      /^(?:look|l|examine|x|inspect|survey|observe|check|scan)(?:\s+(?:at\s+|around\s+|the\s+)?(.+))?$/i,
      /^(?:where am i|what(?:'s| is) (?:here|around|nearby))/i,
      /^(?:describe|show me)(?:\s+(.+))?$/i,
    ],
  },
  {
    intent: 'talk',
    patterns: [
      /^(?:talk|speak|chat|converse|say hello|greet|approach)\s+(?:to\s+|with\s+)?(.+)/i,
      /^(?:hello|hi|hey)\s+(.+)/i,
    ],
  },
  {
    intent: 'ask',
    patterns: [
      /^ask\s+(.+?)\s+(?:about\s+|regarding\s+)(.+)/i,
      /^(?:ask|question|inquire)(?:\s+(?:about\s+)?)?(.+)/i,
    ],
  },
  {
    intent: 'take',
    patterns: [
      /^(?:take|pick up|grab|get|collect|acquire)\s+(?:the\s+)?(.+)/i,
    ],
  },
  {
    intent: 'drop',
    patterns: [
      /^(?:drop|put down|leave|set down|place|put)\s+(?:the\s+)?(.+)/i,
    ],
  },
  {
    intent: 'use',
    patterns: [
      /^(?:use|apply|show)\s+(?:the\s+)?(.+?)(?:\s+(?:on|to|with|at)\s+(.+))?$/i,
    ],
  },
  {
    intent: 'examine',
    patterns: [
      /^(?:read|study|scrutinize|inspect|look\s+closely|examine\s+closely)\s+(?:the\s+)?(.+)/i,
    ],
  },
  {
    intent: 'research',
    patterns: [
      /^(?:research|look up|search for|find out about|investigate)\s+(.+)/i,
    ],
  },
  {
    intent: 'journal',
    patterns: [
      /^(?:journal|notes|diary|my notes|open journal|read journal)$/i,
    ],
  },
  {
    intent: 'inventory',
    patterns: [
      /^(?:inventory|inv|i|my items|what am i carrying|what do i have|items|pockets|bag)$/i,
    ],
  },
  {
    // Must come BEFORE 'help' — "help [name]" means accept a task, not show commands
    intent: 'accept_task',
    patterns: [
      /^(?:help|i(?:'ll)? help|sure[,.]?\s*i(?:'ll)? help|yes[,.]?\s*i(?:'ll)? help)\s+(.+)/i,
      /^(?:accept|take on|i(?:'ll)? do it)\s+(.+)/i,
    ],
  },
  {
    intent: 'stop_helping',
    patterns: [
      /^(?:stop helping|stop\s+(?:the\s+)?task|abandon\s+(?:task|helping)|cancel\s+(?:task|helping))(?:\s+(.+))?$/i,
      /^(?:i\s+(?:can't|cannot|won't|don't want to)\s+help)(?:\s+(.+))?$/i,
    ],
  },
  {
    intent: 'restart_game',
    patterns: [
      /^(?:restart(?: game)?|reset(?: game)?|start over|new game|wipe(?: progress)?|delete(?: my)? progress|clear(?: my)? save)$/i,
    ],
  },
  {
    intent: 'help',
    patterns: [
      /^(?:help|commands|how do i|what can i do|huh\?|what now|hint[s]?)$/i,
      /^\?$/,
    ],
  },
  {
    intent: 'wait',
    patterns: [
      /^(?:wait|rest|sit|relax|pause|do nothing|idle|pass time)(?:\s+(.+))?$/i,
    ],
  },
  {
    intent: 'find',
    patterns: [
      /^(?:where is|where's|where can i find|how do i get to|find|locate|directions? to)\s+(?:the\s+)?(.+)/i,
    ],
  },
  {
    intent: 'catch_up',
    patterns: [
      /^(?:what(?:'s| has| have)? happened?(?:\s+(?:since|while|recently))?|catch me up|what did i miss|what's new|what's going on|town news|chronicle|update me|any news|fill me in)(?:\s+.*)?$/i,
    ],
  },
  {
    intent: 'recall',
    patterns: [
      /^(?:recall|what do i know about|tell me about|my notes on|what have i learned about|remind me about)\s+(?:the\s+)?(.+)/i,
    ],
  },
  {
    intent: 'travel',
    patterns: [
      // "travel to 1866" / "go back to 1866" / "visit 1866"
      /^(?:travel|time travel|jump|transport|warp|teleport)(?:\s+(?:to|back to|forward to))?\s+(.+)/i,
      /^(?:go back to|go forward to|visit|return to)\s+(?:the year\s+|year\s+)?(\d{4})/i,
      /^(?:use|open|activate|open)\s+(?:the\s+)?(?:chrono.?logbook|logbook|time device|time travel device)(?:\s+(?:to|and)\s+go\s+to\s+(.+))?/i,
      /^(?:set|open)\s+(?:the\s+)?logbook\s+to\s+(.+)/i,
    ],
  },
  {
    intent: 'return_present',
    patterns: [
      /^(?:return|go back|travel back|jump back)\s+(?:to\s+)?(?:the\s+)?present(?:\s+day)?$/i,
      /^(?:return|go back|travel back)\s+(?:to\s+)?(?:now|today|current time|my time)$/i,
      /^(?:leave|exit)\s+(?:the\s+)?past$/i,
      /^(?:back to )?the present$/i,
    ],
  },
  {
    intent: 'give',
    patterns: [
      // Player → NPC: "give the honey to Agnes" / "offer the key to Constance" / "hand Marigold the note"
      /^(?:give|offer|hand|present)\s+(?:the\s+)?(.+?)\s+to\s+(.+)/i,
      /^(?:give|hand)\s+(\w+(?:\s+\w+)?)\s+(?:the\s+)?(.+)/i,
      // Player ← NPC: "give me the honey" / "can I have the key"
      /^(?:give me|can i (?:have|get)|i(?:'d| would) like|hand me|pass me)\s+(?:the\s+)?(.+)/i,
      // "take the honey from Agnes" / "get the key from Constance"
      /^(?:take|get)\s+(?:the\s+)?(.+?)\s+from\s+(.+)/i,
      // accepting a pending offer
      /^(?:accept|yes[,.]?\s*(?:please|i(?:'ll)? take it|give it to me)?|take it|i(?:'ll)? take it)$/i,
    ],
  },
  {
    intent: 'solve',
    patterns: [
      // "solve the honey cake mystery" / "deduce the lake light" / "figure out the feud"
      /^(?:solve|deduce|figure out|work out|crack|resolve)\s+(?:the\s+)?(.+)/i,
      // "I think I've solved..." / "I've figured it out..." / "I think I know..."
      /^(?:i(?:'ve)?\s+(?:think\s+i(?:'ve)?|figured|worked out|solved|know\s+the\s+answer))\s+(.+)/i,
      // "I think the answer is..." / "I believe..."
      /^(?:i\s+(?:think|believe)\s+(?:i\s+know|the\s+answer|i\s+have|i've))(.+)/i,
      // bare "deduce" / "what do I know" about mysteries
      /^(?:deduce|what(?:'s| is) the (?:answer|solution)|i(?:'ve)? (?:got it|solved it|figured it out))$/i,
    ],
  },
]

// Precompile first-capture groups
function extractTarget(match: RegExpMatchArray): string | null {
  return match[1]?.trim() || null
}

function tryRegexParse(input: string): ParsedCommand | null {
  const trimmed = input.trim()

  for (const { intent, patterns } of INTENT_PATTERNS) {
    for (const pattern of patterns) {
      const match = trimmed.match(pattern)
      if (match) {
        let target = extractTarget(match)
        let qualifier: string | null = null

        // For intents with two capture groups (ask, give), extract both
        if (match[2]) {
          qualifier = match[2].trim()
          target = match[1]?.trim() || null
        }

        return {
          intent,
          target,
          qualifier,
          raw: input,
          confidence: 0.95,
        }
      }
    }
  }
  return null
}

// ── Tier 2: Claude fallback ───────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are the command parser for a cozy text adventure game set in the small mountain town of Brindlewick.
Your job is to identify the player's intent from natural language input.

Valid intents: go, look, talk, ask, take, drop, use, examine, research, journal, inventory, help, wait, find, catch_up, recall, travel, return_present, solve, give, accept_task, stop_helping, restart_game, unknown

Respond with ONLY valid JSON in this exact shape:
{"intent":"<intent>","target":"<target or null>","qualifier":"<qualifier or null>","confidence":<0.0-1.0>}

Rules:
- "target" is the primary object/person/place the player is interacting with
- "qualifier" is a secondary target or topic modifier (e.g. for "ask Eleanor about the library", target="Eleanor", qualifier="the library")
- Use "unknown" only if the input is completely uninterpretable
- Be generous with interpretation — players in cozy games may express things poetically
- Do not output anything except the JSON object`

async function claudeParse(input: string): Promise<ParsedCommand> {
  try {
    const client = getAnthropicClient()
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 150,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: input }],
    })

    const text = message.content[0].type === 'text' ? message.content[0].text : ''
    const parsed = JSON.parse(text.trim())

    return {
      intent: parsed.intent as CommandIntent,
      target: parsed.target ?? null,
      qualifier: parsed.qualifier ?? null,
      raw: input,
      confidence: parsed.confidence ?? 0.7,
    }
  } catch {
    return { intent: 'unknown', target: null, qualifier: null, raw: input, confidence: 0 }
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function parseCommand(input: string): Promise<ParsedCommand> {
  if (!input?.trim()) {
    return { intent: 'wait', target: null, qualifier: null, raw: input, confidence: 1 }
  }

  // Tier 1
  const regexResult = tryRegexParse(input)
  if (regexResult) return regexResult

  // Tier 2 — Claude fallback for unmatched inputs
  return claudeParse(input)
}

// Synchronous version for server-side pre-processing (no Claude fallback)
export function parseCommandSync(input: string): ParsedCommand {
  if (!input?.trim()) {
    return { intent: 'wait', target: null, qualifier: null, raw: input, confidence: 1 }
  }
  return tryRegexParse(input) ?? {
    intent: 'unknown', target: null, qualifier: null, raw: input, confidence: 0
  }
}
