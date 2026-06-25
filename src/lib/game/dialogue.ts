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
import { getEasternTime, checkBusinessHours } from '../realtime'
import type { DowKey } from '../realtime'
import { getPlayerGossipForNpc, detectAndStorePlayerFact, makePlayerKey } from './gossip'

export interface LocationContext {
  name: string
  business_hours: Partial<Record<DowKey, [number, number] | null>> | null
}

function formatRosterEntry(c: { id?: string; first_name: string; last_name: string; occupation?: string | null; personality?: string | null; household?: string[] }): string {
  const parts = [`- ${c.first_name} ${c.last_name}`]
  if (c.occupation) parts.push(c.occupation)
  if (c.personality) parts.push(`personality: ${c.personality}`)
  if (c.household?.length) parts.push(`family: ${c.household.join(', ')}`)
  // Join with ' | ' after the name
  return parts[0] + (parts.length > 1 ? ' — ' + parts.slice(1).join(' | ') : '')
}

/**
 * Builds a WORLD CONTEXT block for the system prompt so NPCs are aware of
 * the current real-world date, time, season, and their location's hours.
 */
function buildWorldContext(location?: LocationContext): string {
  const et = getEasternTime()
  const season = et.season.charAt(0).toUpperCase() + et.season.slice(1)
  const lines = [
    'WORLD CONTEXT (weave this into responses naturally — do not recite it mechanically):',
    `- It is currently ${et.displayTime} on ${et.displayDate}`,
    `- Season: ${season}`,
  ]

  if (location) {
    if (location.business_hours) {
      const status = checkBusinessHours(location.business_hours, et)
      if (status.open) {
        lines.push(`- You are at ${location.name}${status.closesAt ? `, which closes at ${status.closesAt} today` : ''}`)
      } else {
        const whenOpen = status.opensAt ? ` (opens ${status.opensAt})` : ''
        lines.push(`- You are at ${location.name}, which is currently closed${whenOpen}`)
      }
    } else {
      lines.push(`- You are at ${location.name}`)
    }
  }

  return lines.join('\n')
}

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
  session: GameSession,
  townRoster: Array<{ id?: string; first_name: string; last_name: string; occupation: string | null; personality?: string | null; household?: string[] }> = [],
  priorHistory: ConversationMessage[] = [],
  location?: LocationContext
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
  const rosterLine = townRoster.length
    ? `\n\nBRINDLEWICK RESIDENTS (only refer to names on this list; never invent people):\n${townRoster.map(c => formatRosterEntry(c)).join('\n')}`
    : ''

  const hasHistory = priorHistory.length > 0
  const historyNote = hasHistory
    ? `\n\nPRIOR CONVERSATION HISTORY WITH THIS PLAYER (most recent ${priorHistory.length} messages):\n${priorHistory.map(m => `${m.role === 'user' ? 'Player' : citizen.first_name}: ${m.content}`).join('\n')}\n\nThis player has spoken with you before. Greet them warmly as someone you know. Reference something from your prior conversations naturally if relevant — don't just repeat the same greeting you'd give a stranger.`
    : ''

  const worldContext = buildWorldContext(location)

  try {
    const client = getAnthropicClient()
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 300,
      system: `${TOWN_CONTEXT}\n\n${worldContext}\n\n${citizenContext}${rosterLine}${historyNote}`,
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
  session: GameSession,
  nearbyCitizens: Array<{ first_name: string; last_name: string; occupation: string | null; personality?: string | null; household?: string[] }> = [],
  townRoster: Array<{ id?: string; first_name: string; last_name: string; occupation: string | null; personality?: string | null; household?: string[] }> = [],
  locationMap: Record<string, string> = {},
  location?: LocationContext,
  locationDirectory?: Array<{ id: string; name: string; address?: string | null }>
): Promise<string> {
  const lore = await getLoreForCitizen(supabase, citizen.id, trustLevel)
  const citizenContext = buildCitizenContext(citizen, trustLevel, lore?.lore_text ?? null)
  const motiveContext = buildMotiveContext(citizen, trustLevel)

  // Load gossip this NPC knows about the player
  const playerKey = makePlayerKey(session.playerId, session.guestToken)
  const gossipKnown = await getPlayerGossipForNpc(supabase, citizen.id, playerKey)
  const gossipRating = citizen.gossip_rating ?? 5
  const willShareGossip = gossipRating >= 4 && gossipKnown.length > 0 && Math.random() < gossipRating / 10
  const gossipLine = willShareGossip
    ? `\nGOSSIP YOU KNOW ABOUT THIS PLAYER (mention naturally if relevant — don't force it):\n${gossipKnown.map(g => `- ${g}`).join('\n')}`
    : ''

  // Detect farewell — end conversation gracefully
  const farewellWords = ['bye', 'goodbye', 'farewell', 'see you', 'good night', 'take care', 'gotta go', 'later']
  const isFarewell = farewellWords.some(w => playerMessage.toLowerCase().includes(w))

  const othersHere = nearbyCitizens.filter(c => c.first_name !== citizen.first_name)
  const nearbyLine = othersHere.length
    ? `OTHERS PRESENT AT THIS LOCATION:\n${othersHere.map(c => `- ${c.first_name} ${c.last_name} (${c.occupation ?? 'resident'})`).join('\n')}\nDo not invent or contradict their roles.`
    : ''

  const rosterLine = townRoster.length
    ? `BRINDLEWICK RESIDENTS (real people only — never invent names not on this list):\n${townRoster.map(c => formatRosterEntry(c)).join('\n')}`
    : ''

  const escortLine = Object.keys(locationMap).length > 0
    ? `\nESCORT OFFERS:\nIf it would feel natural to offer to walk the player to a specific place RIGHT NOW (not just mention a place), append exactly [ESCORT:location_id] on a new line at the very end of your response. Use ONLY IDs from this list:\n${Object.entries(locationMap).map(([id, name]) => `  ${id} → ${name}`).join('\n')}\nDo NOT invent location IDs. Only append the tag when you are genuinely offering to escort them immediately.`
    : ''

  const locationDirLine = locationDirectory && locationDirectory.length > 0
    ? `\nTOWN LOCATIONS (you know where all of these are and can give directions):\n${locationDirectory.map(l => `- ${l.name}${l.address ? ` (${l.address})` : ''}`).join('\n')}`
    : ''

  // Build summon capability — only citizens NOT already present
  const presentNames = new Set(nearbyCitizens.map(c => `${c.first_name} ${c.last_name}`))
  const summonableCitizens = townRoster.filter(c => !presentNames.has(`${c.first_name} ${c.last_name}`) && c.id)
  const summonableLine = summonableCitizens.length > 0
    ? `\nSUMMON CAPABILITY:\nIf the player asks to speak with or meet someone you know who isn't currently here but could reasonably come (family member, coworker, neighbor you can call over), you MUST append [SUMMON:citizen_id] on its own line at the very end of your response — this is required for the game to bring them in. Say something like "Let me get her" or "I'll call him over" as part of your natural response, then end with the tag.\nAvailable IDs (only use these exact values):\n${summonableCitizens.map(c => `  ${c.id} → ${c.first_name} ${c.last_name}`).join('\n')}\nDo not invent IDs. Do not summon someone who would have no reason to come.`
    : ''

  const worldContext = buildWorldContext(location)

  const systemPrompt = `${TOWN_CONTEXT}

${worldContext}

${citizenContext}

${motiveContext}
${nearbyLine}
${rosterLine}
${escortLine}
${locationDirLine}
${summonableLine}
${gossipLine}

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

    // Detect personal facts in player's message and store as gossip
    await detectAndStorePlayerFact(supabase, playerMessage, playerKey, citizen.id)

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
