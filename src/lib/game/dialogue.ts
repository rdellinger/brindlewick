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
import type { Citizen, GameSession } from '../../types/game'
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
