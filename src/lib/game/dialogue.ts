/**
 * NPC Dialogue Generator
 *
 * Uses Claude to generate contextually appropriate dialogue for NPCs.
 * The system prompt encodes the citizen's personality, current trust level,
 * topic, and relevant lore so Claude produces in-character responses that
 * advance relationships and mysteries naturally.
 *
 * Cost note: Dialogue calls use claude-haiku. A typical response is
 * 80-200 tokens in + 100-200 tokens out ≈ $0.001. For comparison, a
 * day of active play (50 conversations) costs ~$0.05.
 */

import { getAnthropicClient, MODEL } from '../anthropic/client'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Citizen, ConversationMessage, GameSession } from '../../types/game'
import { getDialogueForCitizen, getLoreForCitizen } from './world'
import { getTrustLevel } from './player'

const TOWN_CONTEXT = `You are generating dialogue for an NPC in Brindlewick, a cozy, safe, warm mountain town text adventure.

TONE RULES (strictly enforced):
- No threats, danger, anger, or hostility anywhere
- Mysteries are about curiosity and history, not danger
- People are genuinely kind, even in conflict (which is mild)
- Warmth, specificity, and a sense of real life are the goals
- NPCs speak with their own voice — not generically
- Responses are 2-5 sentences unless the topic warrants more
- If revealing a mystery clue, do it naturally, not as a dramatic announcement`

export async function generateNpcDialogue(
  supabase: SupabaseClient,
  citizen: Citizen,
  trustLevel: number,
  topic: string,
  session: GameSession
): Promise<string> {
  // First check the database for scripted dialogue
  const scripted = await getDialogueForCitizen(supabase, citizen.id, trustLevel, topic)
  if (scripted && Math.random() > 0.3) {
    // Use scripted dialogue 70% of the time when available (30% variation)
    return formatDialogue(citizen, scripted.content)
  }

  // Get lore for context
  const lore = await getLoreForCitizen(supabase, citizen.id, trustLevel)

  // Build the system prompt
  const citizenContext = buildCitizenContext(citizen, trustLevel, lore?.lore_text ?? null)

  try {
    const client = getAnthropicClient()
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 300,
      system: `${TOWN_CONTEXT}\n\n${citizenContext}`,
      messages: [
        {
          role: 'user',
          content: `The player is talking to you. Topic or context: "${topic}".
Trust level between you: ${trustLevel}/${citizen.trust_max}.
Generate ${citizen.first_name}'s response. Speak in first person as ${citizen.first_name}.`,
        },
      ],
    })

    const text = message.content[0].type === 'text' ? message.content[0].text : ''
    return formatDialogue(citizen, text.trim())
  } catch {
    // Graceful fallback — use lore or generic response
    if (lore?.gossip_text) return formatDialogue(citizen, lore.gossip_text)
    return formatDialogue(citizen, getGenericResponse(citizen, topic, trustLevel))
  }
}

// ── Ongoing Conversation ──────────────────────────────────────────────────────

/**
 * Continue an in-progress conversation with an NPC.
 * Passes full message history to Claude so responses build on prior exchanges.
 * The system prompt encodes the citizen's motive — what they care about and
 * want to steer the conversation toward — derived from their existing data.
 */
export async function continueConversation(
  supabase: SupabaseClient,
  citizen: Citizen,
  trustLevel: number,
  history: ConversationMessage[],
  playerMessage: string,
  _session: GameSession
): Promise<string> {
  const lore = await getLoreForCitizen(supabase, citizen.id, trustLevel)
  const citizenContext = buildCitizenContext(citizen, trustLevel, lore?.lore_text ?? null)
  const motiveContext = buildMotiveContext(citizen, trustLevel)

  // Detect farewell — end conversation gracefully
  const farewellWords = ['bye', 'goodbye', 'farewell', 'see you', 'good night', 'take care', 'gotta go', 'later']
  const isFarewell = farewellWords.some(w => playerMessage.toLowerCase().includes(w))

  const systemPrompt = `${TOWN_CONTEXT}

${citizenContext}

${motiveContext}

CONVERSATION RULES:
- You are mid-conversation with the player. Respond naturally, in first person as ${citizen.first_name}.
- Build on what has already been said — do not repeat yourself or restart from scratch.
- Keep responses 2–4 sentences. Ask a follow-up question occasionally to keep things going.
- Reveal your motive or concerns naturally — don't announce them, just let them surface.
- At higher trust, share more personal things.
${isFarewell ? `- The player is saying goodbye. Give a warm, brief send-off in character.` : ''}`

  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
    ...history,
    { role: 'user', content: playerMessage },
  ]

  try {
    const client = getAnthropicClient()
    const result = await client.messages.create({
      model: MODEL,
      max_tokens: 350,
      system: systemPrompt,
      messages,
    })
    const text = result.content[0].type === 'text' ? result.content[0].text : ''
    return formatDialogue(citizen, text.trim())
  } catch {
    if (lore?.gossip_text) return formatDialogue(citizen, lore.gossip_text)
    return formatDialogue(citizen, getGenericResponse(citizen, playerMessage, trustLevel))
  }
}

/**
 * Build a "motive" section for the system prompt — what the character cares about
 * and wants to discuss, derived from their existing data rather than a new DB field.
 */
function buildMotiveContext(citizen: Citizen, trustLevel: number): string {
  const lines: string[] = ['CURRENT AGENDA (steer conversation toward these naturally):']

  // Personality implies topics they'd raise
  if (citizen.personality) {
    lines.push(`- You have the following personality: ${citizen.personality}. Let it shape how you speak and what you bring up.`)
  }

  // Backstory = things on their mind
  if (citizen.backstory) {
    lines.push(`- Your backstory: ${citizen.backstory}. Relevant details may surface if the conversation goes there.`)
  }

  // Trust-gated depth
  if (trustLevel === 0) {
    lines.push('- This is your first meeting. Be friendly but a little reserved — you don\'t know this person yet.')
  } else if (trustLevel >= 2) {
    lines.push('- You\'ve built real trust with this person. You can mention something personal or a worry you have.')
  } else if (trustLevel >= 3) {
    lines.push('- This person is a genuine friend. You speak freely and can share your real feelings.')
  }

  return lines.join('\n')
}

// ── Single-shot Dialogue ──────────────────────────────────────────────────────

function buildCitizenContext(citizen: Citizen, trustLevel: number, lore: string | null): string {
  const lines = [
    `CHARACTER: ${citizen.first_name} ${citizen.last_name}`,
    `AGE: ${citizen.age}`,
    `OCCUPATION: ${citizen.occupation ?? 'resident'}`,
    `PERSONALITY: ${citizen.personality ?? 'warm, helpful'}`,
    citizen.appearance ? `APPEARANCE: ${citizen.appearance}` : '',
    citizen.backstory ? `BACKSTORY: ${citizen.backstory}` : '',
    '',
    `TRUST LEVEL WITH PLAYER: ${trustLevel} out of ${citizen.trust_max}`,
    trustLevel === 0 ? 'You are meeting this person for the first time.' : '',
    trustLevel >= 2 ? 'You trust this person enough to share something personal.' : '',
    trustLevel >= 3 ? 'This person is a genuine friend. You can share your real thoughts.' : '',
    '',
    lore ? `CURRENT LORE TO POTENTIALLY SHARE: ${lore}` : '',
  ]
  return lines.filter(Boolean).join('\n')
}

function formatDialogue(citizen: Citizen, text: string): string {
  const name = citizen.nickname ?? citizen.first_name
  // Don't prefix if the text already starts with dialogue markers
  if (text.startsWith('"') || text.startsWith('*') || text.startsWith(name)) {
    return text
  }
  return text
}

function getGenericResponse(citizen: Citizen, topic: string, trustLevel: number): string {
  const name = citizen.nickname ?? citizen.first_name
  if (trustLevel === 0) {
    return `${name} gives you a friendly nod. "Welcome to Brindlewick," they say. "It's a good place."`
  }
  if (topic.includes('lake') || topic.includes('light')) {
    return `${name} considers the question for a moment. "The lake is something, isn't it? I've lived here my whole life and it still surprises me sometimes."`
  }
  return `${name} thinks about that for a moment. "I'm not sure I have much to say about that today. But ask me again sometime."`
}
