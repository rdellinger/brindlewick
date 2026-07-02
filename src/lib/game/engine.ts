/**
 * Game Engine — translates parsed commands into narrative responses.
 *
 * This is the core of the game: it handles movement, conversation, item
 * interaction, research, mystery progress, and relationship tracking.
 * All state mutations go through Supabase; the engine is stateless.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ParsedCommand, GameSession, GameResponse, Location, Citizen } from '../../types/game'
import {
  getWorldState, getTimeSlot, getLocationWithExits, getLocationDescription,
  getCitizensAtLocation, findCitizenByName, getCitizen, getLocation,
  getDialogueForCitizen, getLoreForCitizen,
  findLocationByName, getItemsAtLocation, findItemByName, getItem,
  getTownRoster, getItemCurrentState, filterItemsBySeason, checkLocationOpen,
} from './world'
import { getAllLocationsCached } from './world_cache'
import { generateNpcDialogue, continueConversation, LocationContext } from './dialogue'
import type { ConversationMessage } from '../../types/game'
import { updateTrust, getTrustLevel, getConversationHistory, saveConversationHistory, markItemSeen } from './player'
import { checkMysteryClue, handleSolveAttempt, findMysteryByInput, evaluateCondition } from './mysteries'
import {
  getCitizenHoldings, getHoldingsAtLocation,
  processArrivalBehaviors, processInteractionBehaviors, acceptNpcOffer,
} from './npc_items'
import {
  getTimePeriodForDate, getHistoricalLocationDescription,
  getHistoricalCitizensAt, getHistoricalItemsAt,
  findHistoricalCitizenByName, findHistoricalItemByName,
  recordTemporalChange, hasTemporalChange, getPlayerTemporalChanges,
  parseTravelTarget, formatHistoricalDate,
  setTimePosition, grantChronoLogbook,
  TOWN_FOUNDING_YEAR,
} from './temporal'
import { recordWitnessedAction, makePlayerKey } from './gossip'

// ── Main dispatcher ──────────────────────────────────────────────────────────

export async function executeCommand(
  supabase: SupabaseClient,
  command: ParsedCommand,
  session: GameSession
): Promise<GameResponse> {
  const world = await getWorldState(supabase)
  const timeSlot = getTimeSlot()

  switch (command.intent) {
    case 'look':
      return handleLook(supabase, command, session, world, timeSlot)
    case 'go':
      return handleGo(supabase, command, session, world, timeSlot)
    case 'talk':
      return handleTalk(supabase, command, session, world, timeSlot)
    case 'ask':
      return handleAsk(supabase, command, session, world, timeSlot)
    case 'take':
      return handleTake(supabase, command, session)
    case 'drop':
      return handleDrop(supabase, command, session)
    case 'use':
      return handleUse(supabase, command, session, world, timeSlot)
    case 'examine':
      return handleExamine(supabase, command, session)
    case 'research':
      return handleResearch(supabase, command, session)
    case 'journal':
      return handleJournal(supabase, session)
    case 'inventory':
      return handleInventory(session)
    case 'help':
      return handleHelp(command)
    case 'wait':
      return handleWait(supabase, session, world, timeSlot)
    case 'find':
      return handleFind(supabase, command, session, world, timeSlot)
    case 'catch_up':
      return handleCatchUp(supabase, session, world)
    case 'recall':
      return handleRecall(supabase, command, session)
    case 'travel':
      return handleTravel(supabase, command, session, world)
    case 'return_present':
      return handleReturnPresent(supabase, session, world, timeSlot)
    case 'solve':
      return handleSolve(supabase, command, session)
    case 'give':
      return handleGive(supabase, command, session, world, timeSlot)
    case 'accept_task':
      return handleAcceptTask(supabase, command, session)
    case 'stop_helping':
      return handleStopHelping(supabase, command, session)
    case 'restart_game':
      return handleRestartGame()
    default:
      return handleUnknown(command)
  }
}

// ── LOOK ─────────────────────────────────────────────────────────────────────

async function handleLook(
  supabase: SupabaseClient,
  command: ParsedCommand,
  session: GameSession,
  world: { game_date: string; game_season: string },
  timeSlot: string
): Promise<GameResponse> {
  const target = command.target?.toLowerCase()

  // ── Historical mode ──────────────────────────────────────────────────────
  if (session.timePosition) {
    const timePeriod = await getTimePeriodForDate(supabase, session.timePosition)
    if (!timePeriod) return { text: 'The past seems indistinct here.' }

    // Look at a specific item in the past
    if (target) {
      const histItem = await findHistoricalItemByName(supabase, target, session.currentLocation, timePeriod.id)
      if (histItem) {
        let text = `**${histItem.name}**\n\n${histItem.description}`
        if (histItem.lore_note) text += `\n\n*${histItem.lore_note}*`

        // Reveal clue if this item has one and we haven't recorded it yet
        let mystery_update: GameResponse['mystery_update'] = undefined
        if (histItem.reveals_clue && histItem.mystery_tie) {
          const alreadyKnown = await hasTemporalChange(supabase, session, histItem.id, 'knowledge_gained')
          if (!alreadyKnown) {
            await recordTemporalChange(supabase, session, {
              change_type: 'knowledge_gained',
              target_type: 'mystery',
              target_id: histItem.id,
              change_date: session.timePosition,
              effect_present: histItem.reveals_clue,
              mystery_reveal: histItem.mystery_tie,
              clue_text: histItem.reveals_clue,
            })
          }
          mystery_update = await checkMysteryClue(supabase, session, histItem.id, histItem.mystery_tie)
          text += `\n\n*A discovery that will change what you know in the present.*`
        }
        return { text, mystery_update }
      }

      // Look at a historical citizen
      const histCitizens = await getHistoricalCitizensAt(supabase, session.currentLocation, timePeriod.id)
      const hc = histCitizens.find(c =>
        `${c.first_name} ${c.last_name}`.toLowerCase().includes(target) ||
        c.first_name.toLowerCase().includes(target)
      )
      if (hc) {
        return {
          text: hc.appearance
            ? `**${hc.first_name} ${hc.last_name}**\n\n${hc.appearance}`
            : `**${hc.first_name} ${hc.last_name}**\n\n${hc.occupation ?? 'A resident of Brindlewick.'}`,
        }
      }
    }

    // Look around in the past
    const result = await getLocationWithExits(supabase, session.currentLocation)
    if (!result) return { text: 'You find yourself somewhere unfamiliar.', error: 'Location not found' }

    const { location } = result
    const histDesc = await getHistoricalLocationDescription(supabase, location.id, timePeriod.id)
    const baseDesc = histDesc?.description
      ?? getLocationDescription(location, world.game_season, timeSlot)

    let desc = baseDesc

    const histCitizens = await getHistoricalCitizensAt(supabase, location.id, timePeriod.id)
    if (histCitizens.length > 0) {
      const names = histCitizens.map(c => c.first_name).join(', ')
      desc += `\n\nPresent: ${names}.`
    }

    const histItems = await getHistoricalItemsAt(supabase, location.id, timePeriod.id)
    if (histItems.length > 0) {
      const itemNames = histItems.map(i => i.name).join(', ')
      desc += `\n\nYou notice: ${itemNames}.`
    }

    if (histDesc?.special_note) {
      desc += `\n\n*${histDesc.special_note}*`
    }

    const dateLabel = formatHistoricalDate(session.timePosition)
    return {
      text: `**${location.name}** *(${dateLabel})*\n\n${desc}`,
    }
  }

  // ── Present mode ─────────────────────────────────────────────────────────

  // Look at specific item
  if (target) {
    const item = await findItemByName(supabase, target, session.currentLocation, session)
    if (item) {
      let text = `**${item.name}**\n\n${item.description}`
      if (item.lore_note) text += `\n\n*${item.lore_note}*`

      // Log interaction
      await logInteraction(supabase, session, { location_id: session.currentLocation, item_id: item.id, interaction_type: 'examine' })

      return {
        text,
        mystery_update: item.mystery_tie
          ? await checkMysteryClue(supabase, session, item.id, item.mystery_tie)
          : undefined,
      }
    }

    // Look for a citizen
    const citizens = await getCitizensAtLocation(supabase, session.currentLocation, world.game_date, timeSlot)
    const citizen = citizens.find(c =>
      `${c.first_name} ${c.last_name}`.toLowerCase().includes(target) ||
      c.first_name.toLowerCase().includes(target) ||
      (c.nickname?.toLowerCase() ?? '').includes(target)
    )
    if (citizen) {
      return {
        text: citizen.appearance
          ? `**${citizen.first_name} ${citizen.last_name}**\n\n${citizen.appearance}`
          : `**${citizen.first_name} ${citizen.last_name}**\n\n${citizen.occupation ?? 'A resident of Brindlewick.'}`,
      }
    }
  }

  // Look around — describe current location
  // A5: the location fetch, arrival behaviors, and citizens-present query are
  // independent — run them together. Holdings/items run in a second batch
  // because arrival behaviors can transfer items.
  const [result, arrivalNarratives, citizens] = await Promise.all([
    getLocationWithExits(supabase, session.currentLocation),
    processArrivalBehaviors(supabase, session, session.currentLocation, world.game_date, timeSlot),
    getCitizensAtLocation(supabase, session.currentLocation, world.game_date, timeSlot),
  ])
  if (!result) {
    return { text: 'You find yourself in an unfamiliar place.', error: 'Location not found' }
  }

  const { location, exits } = result
  let desc = getLocationDescription(location, world.game_season, timeSlot)

  // Add citizens present, with any items they're visibly carrying
  const [npcHoldings, allItems] = await Promise.all([
    getHoldingsAtLocation(supabase, location.id, world.game_date, timeSlot),
    getItemsAtLocation(supabase, location.id, session),
  ])

  if (citizens.length > 0) {
    const citizenDescs = citizens.map(c => {
      const held = npcHoldings.get(c.id) ?? []
      const name = c.nickname ?? c.first_name
      return held.length > 0
        ? `${name} (carrying: ${held.map(i => i.name).join(', ')})`
        : name
    })
    desc += `\n\nPresent: ${citizenDescs.join(', ')}.`
  }

  // Add visible exits
  if (exits.length > 0) {
    const exitNames = exits.map(e => e.label ? `**${e.label}** to ${e.name}` : e.name).join(', ')
    desc += `\n\nFrom here you can go: ${exitNames}.`
  }

  // Add visible items (season-filtered, state-aware, pass session for player overrides)
  const seasonItems = filterItemsBySeason(allItems, world.game_season)
  const visibleItems = seasonItems.filter(i => !i.requires_condition)

  // Ambient items are woven into the location description inline
  const ambientItems = visibleItems.filter(i => i.is_ambient)
  if (ambientItems.length > 0) {
    const ambientDescs = ambientItems.map(i => {
      const { description } = getItemCurrentState(i)
      return description
    })
    desc += `\n\n${ambientDescs.join(' ')}`
  }

  // Interactive/takeable items listed separately so the player knows they can interact
  const interactiveItems = visibleItems.filter(i => !i.is_ambient)
  if (interactiveItems.length > 0) {
    const itemEntries = interactiveItems.map(i => {
      const { name, state } = getItemCurrentState(i)
      const stateNote = state && state !== i.base_state ? ` *(${state})*` : ''
      return `${name}${stateNote}`
    })
    desc += `\n\nYou notice: ${itemEntries.join(', ')}.`
  }

  // Append any notable NPC transfer narratives from arrival behaviors
  if (arrivalNarratives.length > 0) {
    desc += `\n\n*${arrivalNarratives.join(' ')}*`
  }

  return {
    text: `**${location.name}**\n\n${desc}`,
    location,
  }
}

// ── GO ────────────────────────────────────────────────────────────────────────

function generateWalkNarration(destName: string): string {
  const lines = [
    `You make your way across town to **${destName}**.`,
    `You set off through the streets of Brindlewick, arriving at **${destName}**.`,
    `A short walk brings you to **${destName}**.`,
    `You head through town and find your way to **${destName}**.`,
    `You navigate the familiar streets and arrive at **${destName}**.`,
  ]
  return lines[Math.floor(Math.random() * lines.length)]
}

async function handleGo(
  supabase: SupabaseClient,
  command: ParsedCommand,
  session: GameSession,
  world: { game_date: string; game_season: string },
  timeSlot: string
): Promise<GameResponse> {
  const target = command.target?.toLowerCase()
  if (!target) {
    return { text: 'Where would you like to go? You can look around to see your options.' }
  }

  // Find destination
  const destination = await findLocationByName(supabase, target)
  if (!destination) {
    return {
      text: `You're not sure where "${command.target}" is. You can ask anyone in town for directions.`,
    }
  }

  if (destination.is_locked) {
    return { text: `${destination.name} appears to be closed or locked.` }
  }

  if (destination.boat_required && !session.inventory.includes('rowboat_rental')) {
    return {
      text: `Getting to ${destination.name} requires a boat. Sadie Mirabel at Mira's Boat Rental can help with that.`,
    }
  }

  // Check business hours
  const hoursStatus = checkLocationOpen(destination)
  if (!hoursStatus.open) {
    return { text: hoursStatus.message ?? `${destination.name} is closed right now.` }
  }

  // Update player location, log the visit, and check for a direct exit — all
  // independent writes/reads (A5). logLocationVisit now reports whether this
  // is the player's first visit (A8: previously checked AFTER the row was
  // inserted, so it was always false and the tutorial hint never fired).
  const playerKey = session.playerId ? 'player_id' : 'session_token'
  const playerVal = session.playerId ?? session.guestToken
  const table = session.playerId ? 'player_saves' : 'guest_saves'

  const [, isFirstVisit, directExitResult] = await Promise.all([
    supabase
      .from(table)
      .update({ current_location: destination.id, updated_at: new Date().toISOString() })
      .eq(playerKey, playerVal),
    logLocationVisit(supabase, session, destination.id),
    supabase
      .from('location_exits')
      .select('label')
      .eq('from_loc', session.currentLocation)
      .eq('to_loc', destination.id)
      .eq('blocked', false)
      .maybeSingle(),
  ])
  const directExit = directExitResult.data

  const walkLine = directExit
    ? `You head ${directExit.label ?? 'over'} to **${destination.name}**.`
    : generateWalkNarration(destination.name)

  // Get the new location description
  const result = await getLocationWithExits(supabase, destination.id)
  if (!result) return { text: `${walkLine}` }

  const { location, exits } = result
  let desc = getLocationDescription(location, world.game_season, timeSlot)

  // A5: citizens-present and task-completion checks are independent
  const [citizens, taskCompletion] = await Promise.all([
    getCitizensAtLocation(supabase, location.id, world.game_date, timeSlot),
    checkTaskCompletion(supabase, session, 'visited_location', destination.id),
  ])

  if (citizens.length > 0) {
    const names = citizens.map(c => c.nickname ?? c.first_name).join(', ')
    desc += `\n\nPresent: ${names}.`
  }

  if (exits.length > 0) {
    const exitNames = exits.map(e => e.name).join(', ')
    desc += `\n\nYou can continue to: ${exitNames}.`
  }

  let tutorialHint = ''
  if (isFirstVisit && destination.id === 'copper_kettle_bakery') {
    tutorialHint = `\n\n*Marigold looks up from the counter and smiles. "New in town? The best way to get to know Brindlewick is just to wander and talk to people. Most of us are easy to find if you know where to look — and if you don't, just ask. You can also type 'help' anytime if you're not sure what to do next."*`
  }

  return {
    text: `${walkLine}\n\n${desc}${tutorialHint}${taskCompletion ? `\n\n${taskCompletion}` : ''}`,
    location,
    journal_entry: undefined, // Only log journal for first visits (handled in logLocationVisit)
  }
}

// ── TALK ─────────────────────────────────────────────────────────────────────

async function handleTalk(
  supabase: SupabaseClient,
  command: ParsedCommand,
  session: GameSession,
  world: { game_date: string; game_season: string },
  timeSlot: string
): Promise<GameResponse> {
  const target = command.target?.toLowerCase()
  if (!target) {
    return { text: 'Who would you like to talk to? Look around to see who\'s here.' }
  }

  // ── Historical mode ──────────────────────────────────────────────────────
  if (session.timePosition) {
    const timePeriod = await getTimePeriodForDate(supabase, session.timePosition)
    if (!timePeriod) return { text: 'The past feels hazy here.' }

    const hc = await findHistoricalCitizenByName(supabase, target, timePeriod.id)
    if (!hc) {
      return {
        text: `There's no one by that name here in ${formatHistoricalDate(session.timePosition)}. Perhaps they haven't been born yet, or lived elsewhere.`,
      }
    }

    // Pick a greeting from dialogue_topics
    const greetings: string[] = hc.dialogue_topics?.['greeting'] ?? []
    const greeting = greetings[Math.floor(Math.random() * greetings.length)]
      ?? `${hc.first_name} ${hc.last_name} looks at you. "Hello," they say, with the mild surprise of someone who did not expect a visitor.`

    await logInteraction(supabase, session, {
      citizen_id: hc.id,
      location_id: session.currentLocation,
      interaction_type: 'talk',
      topic: 'greeting',
      time_position: session.timePosition,
    })

    const dateLabel = formatHistoricalDate(session.timePosition)
    return {
      text: `**${hc.first_name} ${hc.last_name}** *(${dateLabel})*\n\n"${greeting}"\n\n*You can ask ${hc.first_name} about specific topics: town, the lake, the statue, and more.*`,
    }
  }

  // ── Present mode ─────────────────────────────────────────────────────────
  const citizens = await getCitizensAtLocation(supabase, session.currentLocation, world.game_date, timeSlot)
  const citizen = citizens.find(c =>
    `${c.first_name} ${c.last_name}`.toLowerCase().includes(target) ||
    c.first_name.toLowerCase().includes(target) ||
    (c.nickname?.toLowerCase() ?? '').includes(target)
  )

  if (!citizen) {
    const anywhere = await findCitizenByName(supabase, target)
    if (anywhere) {
      return {
        text: `${anywhere.first_name} isn't here right now. You might find them at their usual places — try looking around town.`,
      }
    }
    return { text: `There's no one by that name nearby.` }
  }

  // A5: trust, roster (cached), prior history, and location context (cached)
  // are independent — fetch together instead of four sequential round-trips
  const [trustLevel, roster, priorHistory, talkLocRow] = await Promise.all([
    getTrustLevel(supabase, session, citizen.id),
    getTownRoster(supabase),
    getConversationHistory(supabase, session, citizen.id),
    getLocation(supabase, session.currentLocation),
  ])
  const talkLocationCtx: LocationContext | undefined = talkLocRow
    ? { name: talkLocRow.name, business_hours: (talkLocRow.business_hours ?? null) as LocationContext['business_hours'] }
    : undefined

  // Check Eleanor's trust-gated quest chain
  const eleanorResponse = await handleEleanorQuestProgress(supabase, session, citizen, trustLevel)

  // Generate greeting — if there's prior history, acknowledge the relationship
  const greetingTopic = priorHistory.length > 0 ? 'returning_visitor' : 'greeting'
  const dialogue = eleanorResponse ?? await generateNpcDialogue(supabase, citizen, trustLevel, greetingTopic, session, roster, priorHistory, talkLocationCtx)

  // Increase trust slightly on each interaction
  const newTrust = await updateTrust(supabase, session, citizen.id, trustLevel, 0.5)

  // Check for available help task from this citizen
  const taskOffer = newTrust >= 1
    ? await getAvailableTaskOffer(supabase, session, citizen)
    : null

  // Check if this is first meeting or a trust milestone
  const isFirstMeet = trustLevel === 0
  const isNewMilestone = newTrust > Math.floor(trustLevel)

  // Build milestone message from citizen's trust_stages if available
  const milestoneMessage = isNewMilestone
    ? await getTrustMilestoneMessage(supabase, citizen.id, newTrust)
    : null

  let fullText = milestoneMessage
    ? `${dialogue}\n\n*${milestoneMessage}*`
    : dialogue

  if (taskOffer) {
    fullText += `\n\n${taskOffer}`
  }

  // Process on_talk NPC item behaviors (offers and immediate gifts)
  const { offers, immediateGifts } = await processInteractionBehaviors(
    supabase, session, citizen.id, session.currentLocation, 'on_talk'
  )

  // Append immediate gift narrative
  for (const gift of immediateGifts) {
    if (gift.narrativeHint) fullText += `\n\n${gift.narrativeHint}`
  }

  // Log interaction for memory
  await logInteraction(supabase, session, {
    citizen_id: citizen.id,
    location_id: session.currentLocation,
    interaction_type: 'talk',
    topic: 'greeting',
  })

  // First offer takes precedence (rare for multiple to fire at once)
  const firstOffer = offers[0]
  const inventoryAfterGifts = immediateGifts.length > 0
    ? [...session.inventory, ...immediateGifts.map(g => g.item!.id)]
    : undefined

  return {
    text: fullText,
    conversation_start: { citizenId: citizen.id, citizenName: `${citizen.first_name} ${citizen.last_name}`, priorHistory },
    trust_update: newTrust !== Math.floor(trustLevel) ? { citizen_id: citizen.id, new_level: newTrust } : undefined,
    inventory_update: inventoryAfterGifts,
    task_update: taskOffer ? true : undefined,
    pending_npc_offer: firstOffer ?? undefined,
    journal_entry: isFirstMeet ? {
      id: '',
      entry_type: 'citizen_met',
      title: `Met ${citizen.first_name} ${citizen.last_name}`,
      content: `${citizen.first_name} ${citizen.last_name}, ${citizen.occupation ?? 'resident'}. ${citizen.personality ?? ''}`,
      related_id: citizen.id,
      game_date: world.game_date,
      created_at: new Date().toISOString(),
    } : undefined,
  }
}

// ── CONVERSATION MESSAGE ──────────────────────────────────────────────────────

/**
 * Handle a free-text message from the player while in an active conversation.
 * Receives the full conversation history and the new player message, returns
 * the NPC's next response.
 */
export async function handleConversationMessage(
  supabase: SupabaseClient,
  citizenId: string,
  history: ConversationMessage[],
  playerMessage: string,
  session: GameSession,
  pendingEscortOffer?: { destination_id: string; destination_name: string }
): Promise<GameResponse> {
  // Local mutable copy so inventory stays accurate if the player receives items mid-conversation
  let currentInventory = [...session.inventory]
  const world = await getWorldState(supabase)
  const timeSlot = getTimeSlot()

  // A1: the citizen row, trust level, save-row overrides, roster (cached),
  // and location list (cached) are all independent — one parallel batch
  // replaces five sequential round-trips.
  const saveTable = session.playerId ? 'player_saves' : 'guest_saves'
  const saveKey = session.playerId ? 'player_id' : 'session_token'
  const saveVal = session.playerId ?? session.guestToken

  const [citizen, trustLevel, saveRowResult, roster, allLocationRows] = await Promise.all([
    getCitizen(supabase, citizenId),
    getTrustLevel(supabase, session, citizenId),
    supabase.from(saveTable).select('citizen_overrides').eq(saveKey, saveVal).single(),
    getTownRoster(supabase),
    getAllLocationsCached(supabase),
  ])

  if (!citizen) {
    return { text: 'The conversation fades. That person seems to have stepped away.', conversation_end: true }
  }

  const citizenOverrides: Record<string, string> = (saveRowResult.data?.citizen_overrides as Record<string, string>) ?? {}

  // Fetch other citizens at the same location so the NPC knows who's nearby
  // (depends on citizenOverrides, so it runs after the batch above)
  const nearbyCitizens = await getCitizensAtLocation(supabase, session.currentLocation, world.game_date, timeSlot, citizenOverrides)

  // Build locationMap for escort offers — all non-hidden locations so the NPC
  // can generate [ESCORT:id] for any place in town, not just adjacent exits.
  // NOTE (bug fix, found during A2): the previous query selected a nonexistent
  // `address` column on locations, so PostgREST rejected it and allLocations
  // was always null — the escort map, location directory, and location context
  // were silently empty on every conversation message. The cache restores the
  // intended behavior at zero query cost.
  const allLocations = allLocationRows.filter(l => !l.is_hidden)
  const locationMap: Record<string, string> = {}
  for (const loc of allLocations) {
    locationMap[loc.id] = loc.name
  }
  const currentLocData = allLocations.find(l => l.id === session.currentLocation)
  const locationContext: LocationContext | undefined = currentLocData
    ? { name: currentLocData.name, business_hours: (currentLocData.business_hours ?? null) as LocationContext['business_hours'] }
    : undefined

  // Build locationDirectory for NPC map knowledge (includes hours so NPCs can answer "when does X close?")
  const locationDirectory = allLocations.map(l => ({
    id: l.id,
    name: l.name,
    address: null as string | null,   // locations have no address column (see note above)
    business_hours: (l.business_hours ?? null) as Partial<Record<string, [number, number] | null>> | null,
  }))

  // Detect farewell words — end conversation after response
  const farewellWords = ['bye', 'goodbye', 'farewell', 'see you', 'good night', 'take care', 'gotta go', 'later', 'leave']
  const isFarewell = farewellWords.some(w => playerMessage.toLowerCase().includes(w))

  // Generate response using full history
  const rawResponse = await continueConversation(supabase, citizen, trustLevel, history, playerMessage, session, nearbyCitizens, roster, locationMap, locationContext, locationDirectory)

  // Parse and strip [ESCORT:location_id] tag if present
  const escortMatch = rawResponse.match(/\[ESCORT:([a-z_]+)\]/)
  const escortedToId = escortMatch?.[1] ?? null

  // Parse [SUMMON:citizen_id] tag
  let summonMatch = rawResponse.match(/\[SUMMON:([a-z_]+)\]/)

  // Fallback: if the player asked to speak with someone by name, the NPC agreed (no decline),
  // but forgot the tag — infer it from the roster
  if (!summonMatch) {
    const askMatch = playerMessage.match(/\b(?:talk|speak|chat|meet|see|find)\b.{0,20}?\b(?:with|to)\b\s+(.+)/i)
      ?? playerMessage.match(/^(?:can i|could i|i'?d like to|i want to)\s+(?:talk|speak|chat|meet|see|find)\b.{0,20}?\b(.+)/i)
    const npcAgreed = /\b(she'?s coming|he'?s coming|i'?ll (get|call|fetch|grab)|let me get|right out|coming now|on (?:her|his) way|calling|give (?:her|him) a second)\b/i.test(rawResponse)
    if (askMatch && npcAgreed) {
      const nameQuery = askMatch[1].trim().replace(/[?.!,].*$/, '').replace(/^(with|to)\s+/i, '').trim()
      const matched = roster.find(c =>
        `${c.first_name} ${c.last_name}`.toLowerCase().includes(nameQuery.toLowerCase()) ||
        c.first_name.toLowerCase() === nameQuery.toLowerCase()
      )
      if (matched && matched.id) {
        summonMatch = ['', matched.id] as RegExpMatchArray
      }
    }
  }

  const summonCitizenId = summonMatch?.[1] ?? null
  const cleanResponse = rawResponse.replace(/\s*\[SUMMON:[a-z_]+\]/, '')

  const response = cleanResponse.replace(/\s*\[ESCORT:[a-z_]+\]/, '')

  // A1: trust update, history persistence, and interaction logging are
  // independent writes — run as one batch instead of three sequential awaits
  const [newTrust] = await Promise.all([
    updateTrust(supabase, session, citizenId, trustLevel, 0.25),
    saveConversationHistory(supabase, session, citizenId, [
      { role: 'user', content: playerMessage },
      { role: 'assistant', content: response },
    ]),
    logInteraction(supabase, session, {
      citizen_id: citizenId,
      location_id: session.currentLocation,
      interaction_type: 'talk',
      topic: playerMessage.slice(0, 100),
    }),
  ])

  // ── Detect item requests in conversation ────────────────────────────────────
  // If the player asks to order/buy/receive something, run on_ask behaviors so
  // the item is actually added to inventory (not just narrated by the AI).
  let inventoryUpdate: string[] | undefined
  const msgLower = playerMessage.toLowerCase()
  const isItemRequest = /\b(order|buy|purchase|get|take|have|i'?d like|can i get|i'?ll have)\b/.test(msgLower)
  if (isItemRequest) {
    const holdings = await getCitizenHoldings(supabase, citizenId)
    for (const item of holdings) {
      const itemWords = item.name.toLowerCase().split(/\s+/)
      const playerWords = msgLower.split(/\s+/)
      const wordOverlap = itemWords.some(w => w.length > 3 && playerWords.some(p => p.includes(w) || w.includes(p)))
      if (wordOverlap && !currentInventory.includes(item.id)) {
        const { immediateGifts } = await processInteractionBehaviors(
          supabase, { ...session, inventory: currentInventory }, citizenId, session.currentLocation, 'on_ask', item.id
        )
        if (immediateGifts.length > 0) {
          currentInventory = [...currentInventory, item.id]
          inventoryUpdate = currentInventory
        }
      }
    }
  }

  // ── Detect task acceptance in conversation ──────────────────────────────────
  // If the player says yes to a task, mark it in_progress so the Helping
  // sidebar updates without requiring a fresh `talk` command.
  let taskUpdate: boolean | undefined
  const isAccepting = /\b(yes|yeah|yep|yup|sure|okay|ok|of course|absolutely|definitely|certainly|gladly|i'?ll (help|do it|go)|happy to|i (can|will)|i'?d (love|like) to|sounds (good|great|wonderful|lovely)|that (sounds|would be)|great|perfect|wonderful|let'?s (go|do it)|lead the way|alright|all right|by all means|count me in|please do|why not)\b/.test(msgLower)
    && !/\bnot (sure|certain|really|quite|yet)\b/.test(msgLower)
  if (isAccepting) {
    const saveKey = session.playerId ? 'player_id' : 'guest_token'
    const saveVal = session.playerId ?? session.guestToken
    // Find available tasks from this citizen
    const { data: availableTasks } = await supabase
      .from('player_task_progress')
      .select('task_id, help_tasks!inner(giver_citizen)')
      .eq(saveKey, saveVal)
      .eq('status', 'offered')
      .eq('help_tasks.giver_citizen', citizenId)
    if (availableTasks?.length) {
      await supabase
        .from('player_task_progress')
        .update({ status: 'in_progress', started_at: new Date().toISOString() })
        .eq(saveKey, saveVal)
        .in('task_id', availableTasks.map((t: { task_id: string }) => t.task_id))
      taskUpdate = true
    }
  }

  // ── Handle escort execution ─────────────────────────────────────────────────
  // Three cases:
  //   A) Player directly requested escort → parse destination from their message,
  //      resolve with findLocationByName (same as 'go' command), execute if NPC agrees.
  //      Does NOT depend on NPC generating [ESCORT:] tag.
  //   B) NPC had already offered via [ESCORT:] tag (pendingEscortOffer set) and player accepts.
  //   C) NPC generated [ESCORT:] tag this turn but player didn't directly ask → store as offer.

  const isEscortRequest = /\b(escort|walk\s+(me|with\s+me)|take\s+me|show\s+me|guide\s+me|lead\s+me|bring\s+me|come\s+with\s+me)\b/.test(msgLower)

  // Case A: extract destination from the player's words
  let playerRequestedDestId: string | null = null
  if (isEscortRequest) {
    const destMatch = playerMessage.match(
      /\b(?:escort|walk|take|show|guide|lead|bring|come)\s+(?:with\s+)?(?:me\s+)?(?:(?:the\s+way\s+)?to\s+(?:the\s+)?|over\s+to\s+(?:the\s+)?|where\s+(?:the\s+)?)?(.+)/i
    )
    if (destMatch) {
      const raw = destMatch[1]
        .trim()
        .replace(/[?.!,].*$/, '')                                                           // strip trailing punctuation
        .replace(/\s+\b(please|now|right now|quickly|if you can|if you don't mind)\b.*$/i, '') // strip filler
        .replace(/\s+\bis\b.*$/i, '')                                                       // strip "where X is"
        .trim()
      const query = raw.replace(/^the\s+/i, '').trim()
      const destLocation = await findLocationByName(supabase, query)
      playerRequestedDestId = destLocation?.id ?? null
      console.log('[escort] player requested:', query, '→', playerRequestedDestId)
    }
  }

  // NPC declining words — don't move the player if they refused
  const npcDeclined = /\b(can'?t|cannot|sorry|afraid|unable|don'?t know the way|not sure|wouldn'?t|don'?t think I can|not able)\b/i.test(response)

  const escortDestId =
    // Case A: player asked + destination resolved + NPC didn't refuse
    (playerRequestedDestId && !npcDeclined) ? playerRequestedDestId
    // Case B: player accepted a previously-stored offer
    : (isAccepting && pendingEscortOffer) ? pendingEscortOffer.destination_id
    : null

  console.log('[escort] escortDestId:', escortDestId, '| isEscortRequest:', isEscortRequest, '| playerRequestedDestId:', playerRequestedDestId, '| npcDeclined:', npcDeclined, '| pendingEscortOffer:', pendingEscortOffer?.destination_id)

  if (escortDestId) {
    const playerKey = session.playerId ? 'player_id' : 'session_token'
    const playerVal = session.playerId ?? session.guestToken
    const table = session.playerId ? 'player_saves' : 'guest_saves'

    console.log('[escort] moving player to:', escortDestId, 'table:', table, 'key:', playerKey, 'val:', playerVal)

    const { error: updateErr } = await supabase
      .from(table)
      .update({ current_location: escortDestId, updated_at: new Date().toISOString() })
      .eq(playerKey, playerVal)

    if (updateErr) console.error('[escort] DB update error:', updateErr)

    const updatedSession = { ...session, currentLocation: escortDestId }
    await logLocationVisit(supabase, updatedSession, escortDestId)

    const newLocationResult = await getLocationWithExits(supabase, escortDestId)
    console.log('[escort] newLocation:', newLocationResult?.location?.name)
    return {
      text: response,
      location: newLocationResult?.location,
      conversation_end: true,
      trust_update: newTrust !== Math.floor(trustLevel) ? { citizen_id: citizenId, new_level: newTrust } : undefined,
      inventory_update: inventoryUpdate,
      task_update: taskUpdate,
      escorting_citizen: {
        id: citizenId,
        name: `${citizen.first_name} ${citizen.last_name}`,
        occupation: citizen.occupation,
        trust_level: newTrust,
      },
    }
  }

  // Case C: NPC generated [ESCORT:] tag proactively (store as pending offer for next turn)
  const escortOffer = escortedToId
    ? {
        destination_id: escortedToId,
        destination_name: locationMap[escortedToId] ?? escortedToId.replace(/_/g, ' '),
        citizen_id: citizenId,
        citizen_name: `${citizen.first_name} ${citizen.last_name}`,
      }
    : undefined

  // Handle [SUMMON:citizen_id] — store override and return summoned citizen info
  if (summonCitizenId) {
    const summonedCitizen = await getCitizen(supabase, summonCitizenId)
    if (summonedCitizen) {
      const newOverrides = { ...citizenOverrides, [summonCitizenId]: session.currentLocation }
      await supabase
        .from(saveTable)
        .update({ citizen_overrides: newOverrides })
        .eq(saveKey, saveVal)

      return {
        text: response,
        summoned_citizen: {
          id: summonedCitizen.id,
          name: `${summonedCitizen.first_name} ${summonedCitizen.last_name}`,
        },
        conversation_end: true,
        trust_update: newTrust !== Math.floor(trustLevel) ? { citizen_id: citizenId, new_level: newTrust } : undefined,
        inventory_update: inventoryUpdate,
        task_update: taskUpdate,
      }
    }
  }

  return {
    text: response,
    conversation_end: isFarewell ? true : undefined,
    trust_update: newTrust !== Math.floor(trustLevel) ? { citizen_id: citizenId, new_level: newTrust } : undefined,
    inventory_update: inventoryUpdate,
    task_update: taskUpdate,
    escort_offer: escortOffer,
  }
  void world; void timeSlot  // suppress unused warnings
}

// ── ASK ───────────────────────────────────────────────────────────────────────

async function handleAsk(
  supabase: SupabaseClient,
  command: ParsedCommand,
  session: GameSession,
  world: { game_date: string; game_season: string },
  timeSlot: string
): Promise<GameResponse> {
  const citizenName = command.target?.toLowerCase()
  const topic = command.qualifier?.toLowerCase() ?? 'town'

  if (!citizenName) {
    return { text: 'Ask who about what? Try: ask [name] about [topic]' }
  }

  // ── Historical mode ──────────────────────────────────────────────────────
  if (session.timePosition) {
    const timePeriod = await getTimePeriodForDate(supabase, session.timePosition)
    if (!timePeriod) return { text: 'The past is hard to read here.' }

    const hc = await findHistoricalCitizenByName(supabase, citizenName, timePeriod.id)
    if (!hc) {
      return { text: `${command.target} isn't here in this time.` }
    }

    // Find matching dialogue topic
    const topicKey = Object.keys(hc.dialogue_topics ?? {}).find(k => topic.includes(k) || k.includes(topic))
    const lines: string[] = topicKey ? (hc.dialogue_topics[topicKey] ?? []) : []
    const line = lines[Math.floor(Math.random() * lines.length)]

    if (!line) {
      return {
        text: `${hc.first_name} listens to your question and looks thoughtful. "I'm not sure I know much about that," they say.`,
      }
    }

    await logInteraction(supabase, session, {
      citizen_id: hc.id,
      location_id: session.currentLocation,
      interaction_type: 'ask',
      topic,
      time_position: session.timePosition,
    })

    // Special: asking Cornelius about the mechanism reveals the statue secret
    let mystery_update: GameResponse['mystery_update'] = undefined
    if (hc.id === 'cornelius_webb' && (topic.includes('mechanism') || topic.includes('statue') || topic.includes('secret'))) {
      const alreadyKnown = await hasTemporalChange(supabase, session, 'statue_mechanism', 'mechanism_understood')
      if (!alreadyKnown) {
        await recordTemporalChange(supabase, session, {
          change_type: 'mechanism_understood',
          target_type: 'mystery',
          target_id: 'statue_mechanism',
          change_date: session.timePosition,
          effect_present: 'You understand the statue mechanism: a mercury float bearing with temperature differential drive, completing one rotation per year, aligned to winter solstice.',
          mystery_reveal: 'rotating_statue',
          clue_text: 'Cornelius Webb built a hidden astronomical mechanism into the statue — mercury float, temperature differential, one rotation per year ending at winter solstice.',
        })
        mystery_update = await checkMysteryClue(supabase, session, 'cornelius_webb_mechanism', 'rotating_statue')
      }
    }

    return {
      text: `"${line}"`,
      mystery_update,
    }
  }

  // ── Present mode ─────────────────────────────────────────────────────────
  const citizens = await getCitizensAtLocation(supabase, session.currentLocation, world.game_date, timeSlot)
  const citizen = citizens.find(c =>
    `${c.first_name} ${c.last_name}`.toLowerCase().includes(citizenName) ||
    c.first_name.toLowerCase().includes(citizenName)
  )

  if (!citizen) {
    return { text: `${command.target} isn't here right now.` }
  }

  // A5: trust and location context (cached) fetched together
  const [trustLevel, askLocRow] = await Promise.all([
    getTrustLevel(supabase, session, citizen.id),
    getLocation(supabase, session.currentLocation),
  ])
  const askLocationCtx: LocationContext | undefined = askLocRow
    ? { name: askLocRow.name, business_hours: (askLocRow.business_hours ?? null) as LocationContext['business_hours'] }
    : undefined
  const dialogue = await generateNpcDialogue(supabase, citizen, trustLevel, topic, session, [], [], askLocationCtx)

  // Check for mystery clue unlock
  const mysteryUpdate = await checkTopicForMysteryClue(supabase, session, citizen.id, topic, trustLevel)

  const newTrust = await updateTrust(supabase, session, citizen.id, trustLevel, 0.3)
  const isNewMilestone = newTrust > Math.floor(trustLevel)
  const milestoneMessage = isNewMilestone
    ? await getTrustMilestoneMessage(supabase, citizen.id, newTrust)
    : null

  const fullText = milestoneMessage
    ? `${dialogue}\n\n*${milestoneMessage}*`
    : dialogue

  // Log interaction
  await logInteraction(supabase, session, {
    citizen_id: citizen.id,
    location_id: session.currentLocation,
    interaction_type: 'ask',
    topic,
  })

  return {
    text: fullText,
    mystery_update: mysteryUpdate,
    trust_update: newTrust !== Math.floor(trustLevel) ? { citizen_id: citizen.id, new_level: newTrust } : undefined,
  }
}

// ── TAKE ─────────────────────────────────────────────────────────────────────

/**
 * Returns a contextual "why can't I take this?" message based on item type.
 * Used when can_take is false and there's no gating condition.
 */
function getCannotTakeMessage(item: import('../../types/game').Item): string {
  switch (item.type) {
    case 'examine':
      // Statues, inscriptions, architectural features
      return `${item.name} is fixed in place — far too large or heavy to carry.`
    case 'research_interface':
      return `${item.name} is part of the library's permanent collection. You can use it here.`
    case 'readable':
      // Plaques, guest books, framed items mounted on walls
      return `${item.name} is fixed where it is. You can read it, but it's not yours to take.`
    case 'clue_item':
      // Items that belong to a location — gravestone, watercolor in archive, inscription
      return `${item.name} belongs here. Taking it would be wrong.`
    default:
      return `${item.name} isn't something you can carry.`
  }
}

async function handleTake(
  supabase: SupabaseClient,
  command: ParsedCommand,
  session: GameSession
): Promise<GameResponse> {
  const target = command.target?.toLowerCase()
  if (!target) return { text: 'What would you like to take?' }

  const item = await findItemByName(supabase, target, session.currentLocation, session)
  if (!item) {
    return { text: `You don't see ${command.target} here.` }
  }

  if (!item.can_take) {
    // Item has a condition — it might become takeable later
    if (item.requires_condition) {
      const conditionMet = await evaluateCondition(supabase, session, item.requires_condition)
      if (conditionMet) {
        // Condition is now met: allow the pickup even though can_take was false at seed time
        // (This supports items that unlock through game progress)
      } else {
        return { text: `You can't take ${item.name} yet — you haven't earned the right to carry it.` }
      }
    } else {
      // Permanently immovable — give a contextual reason based on item type
      return { text: getCannotTakeMessage(item) }
    }
  }

  if (session.inventory.includes(item.id)) {
    return { text: `You're already carrying ${item.name}.` }
  }

  // Add to inventory
  const newInventory = [...session.inventory, item.id]
  const table = session.playerId ? 'player_saves' : 'guest_saves'
  const key = session.playerId ? 'player_id' : 'session_token'
  const val = session.playerId ?? session.guestToken

  await supabase.from(table).update({ inventory: newInventory }).eq(key, val)

  // If the player had previously dropped this item somewhere, clear that override
  const pilKey = session.playerId ? 'player_id' : 'guest_token'
  const pilVal = session.playerId ?? session.guestToken
  await supabase.from('player_item_locations').delete()
    .eq(pilKey, pilVal)
    .eq('item_id', item.id)

  // Check if picking this item up completes a task
  const taskCompletion = await checkTaskCompletion(supabase, session, 'visited_location', session.currentLocation)

  // Record witnessed action if other citizens are present
  try {
    const world = await getWorldState(supabase)
    const timeSlot = getTimeSlot()
    const witnesses = await getCitizensAtLocation(supabase, session.currentLocation, world.game_date, timeSlot)
    const witnessIds = witnesses.map(c => c.id)
    if (witnessIds.length > 0) {
      const playerKey = makePlayerKey(session.playerId, session.guestToken)
      const locRow = await getLocation(supabase, session.currentLocation)  // A2: cached
      const locationName = locRow?.name ?? session.currentLocation
      await recordWitnessedAction(
        supabase, playerKey,
        `The visitor was seen taking ${item.name} from ${locationName}`,
        session.currentLocation, witnessIds
      )
    }
  } catch {
    // Non-fatal — gossip recording failure should never break gameplay
  }

  return {
    text: taskCompletion
      ? `You pick up ${item.name}.\n\n${taskCompletion}`
      : `You pick up **${item.name}**.`,
    inventory_update: newInventory,
    journal_entry: {
      id: '',
      entry_type: 'item_found',
      title: `Found: ${item.name}`,
      content: item.description,
      related_id: item.id,
      game_date: null,
      created_at: new Date().toISOString(),
    },
  }
}

// ── DROP ──────────────────────────────────────────────────────────────────────

async function handleDrop(
  supabase: SupabaseClient,
  command: ParsedCommand,
  session: GameSession
): Promise<GameResponse> {
  const target = command.target?.toLowerCase()
  if (!target) return { text: 'What would you like to put down?' }

  // Find the item in the player's inventory
  const carriedItem = session.inventory.find(id =>
    id.toLowerCase().replace(/_/g, ' ').includes(target) ||
    target.includes(id.toLowerCase().replace(/_/g, ' '))
  )

  if (!carriedItem) {
    // Try name match against full item records in inventory
    const invItems = await Promise.all(
      session.inventory.map(id => getItem(supabase, id))
    )
    const match = invItems.find(i => i && i.name.toLowerCase().includes(target))
    if (!match) {
      return { text: `You're not carrying anything called "${command.target}".` }
    }
    return dropItem(supabase, session, match)
  }

  const item = await getItem(supabase, carriedItem)
  if (!item) return { text: `You don't seem to have that.` }

  return dropItem(supabase, session, item)
}

async function dropItem(
  supabase: SupabaseClient,
  session: GameSession,
  item: import('../../types/game').Item
): Promise<GameResponse> {
  const saveTable = session.playerId ? 'player_saves' : 'guest_saves'
  const saveKey  = session.playerId ? 'player_id'   : 'session_token'
  const saveVal  = session.playerId ?? session.guestToken

  const pilKey = session.playerId ? 'player_id' : 'guest_token'
  const pilVal = session.playerId ?? session.guestToken

  // Remove from inventory
  const newInventory = session.inventory.filter(id => id !== item.id)
  await supabase.from(saveTable).update({ inventory: newInventory }).eq(saveKey, saveVal)

  // Record the new location in player_item_locations.
  // Use delete + insert rather than upsert: the unique indexes are partial (WHERE player_id IS NOT NULL /
  // WHERE guest_token IS NOT NULL), which Supabase's onConflict can't reference by column name alone.
  await supabase.from('player_item_locations')
    .delete()
    .eq(pilKey, pilVal)
    .eq('item_id', item.id)
  await supabase.from('player_item_locations')
    .insert({ [pilKey]: pilVal, item_id: item.id, location_id: session.currentLocation, moved_at: new Date().toISOString() })

  return {
    text: `You set down **${item.name}**.${item.lore_note ? `\n\n*${item.lore_note}*` : ''}`,
    inventory_update: newInventory,
  }
}

// ── USE ───────────────────────────────────────────────────────────────────────

async function handleUse(
  supabase: SupabaseClient,
  command: ParsedCommand,
  session: GameSession,
  world: { game_date: string; game_season: string },
  timeSlot: string
): Promise<GameResponse> {
  const itemName = command.target?.toLowerCase()
  const targetName = command.qualifier?.toLowerCase()

  if (!itemName) return { text: 'Use what?' }

  // Check inventory first, then location
  const inventoryItem = session.inventory.find(id => id.includes(itemName.replace(/\s+/g, '_')))
  const item = inventoryItem
    ? await supabase.from('items').select('*').eq('id', inventoryItem).single().then(r => r.data)
    : await findItemByName(supabase, itemName, session.currentLocation, session)

  if (!item) {
    return { text: `You don't have ${command.target}.` }
  }

  // Handle specific use cases
  if (item.id === 'perkins_alpine_honey' && targetName?.includes('mari')) {
    return handleHoneyOnMari(supabase, session, world, timeSlot)
  }

  // If the item is consumable, consume it now — whether from inventory or at the location
  if (item.is_consumable) {
    const pciKey = session.playerId ? 'player_id' : 'guest_token'
    const pciVal = session.playerId ?? session.guestToken
    const consumeText = `You use ${item.name}. ${item.lore_note ?? "It's gone now."}`

    if (session.inventory.includes(item.id)) {
      // Remove from inventory
      const newInventory = session.inventory.filter(id => id !== item.id)
      const table  = session.playerId ? 'player_saves'  : 'guest_saves'
      const saveKey = session.playerId ? 'player_id'    : 'session_token'
      const saveVal = session.playerId ?? session.guestToken
      await supabase.from(table).update({ inventory: newInventory }).eq(saveKey, saveVal)
      await supabase.from('player_consumed_items').insert({ [pciKey]: pciVal, item_id: item.id })
      return { text: consumeText, inventory_update: newInventory }
    } else {
      // Item is at the current location — remove it from the world for this player
      // by logging it to player_item_locations with a '__consumed__' sentinel location
      const pilKey = session.playerId ? 'player_id' : 'guest_token'
      const pilVal = session.playerId ?? session.guestToken
      await supabase.from('player_item_locations')
        .delete().eq(pilKey, pilVal).eq('item_id', item.id)
      await supabase.from('player_item_locations')
        .insert({ [pilKey]: pilVal, item_id: item.id, location_id: '__consumed__', moved_at: new Date().toISOString() })
      await supabase.from('player_consumed_items').insert({ [pciKey]: pciVal, item_id: item.id })
      return { text: consumeText, inventory_update: session.inventory }
    }
  }

  return {
    text: `You use ${item.name}. It doesn't seem to have any obvious effect here.`,
  }
}

async function handleHoneyOnMari(
  supabase: SupabaseClient,
  session: GameSession,
  world: { game_date: string; game_season: string },
  timeSlot: string
): Promise<GameResponse> {
  const citizens = await getCitizensAtLocation(supabase, session.currentLocation, world.game_date, timeSlot)
  const mari = citizens.find(c => c.id === 'marigold_osei')

  if (!mari) {
    return { text: "Marigold isn't here right now. She'd need to be at the bakery for this." }
  }

  const trustLevel = await getTrustLevel(supabase, session, 'marigold_osei')
  if (trustLevel < 2) {
    return { text: "You'd need to know Mari better before she'd let you bring mystery ingredients into her kitchen." }
  }

  // Complete the missing recipe mystery
  await supabase.from('player_mystery_progress')
    .upsert({
      player_id: session.playerId,
      guest_token: session.guestToken,
      mystery_id: 'missing_recipe',
      is_resolved: true,
      resolved_at: new Date().toISOString(),
    })

  await updateTrust(supabase, session, 'marigold_osei', trustLevel, 2)

  return {
    text: `You hand Marigold the jar of Perkins alpine honey. She takes it, opens it, and holds it under her nose for a long moment.\n\n"Oh," she says quietly.\n\nShe adds it to the cake she's been working on — just a small amount, the way the recipe card suggests. You watch her take a taste of the batter.\n\nA long pause. Then something crosses her face that you've never seen there before: relief, maybe, or the particular joy of something completed at last.\n\n"That's it," she says softly. "That's exactly it."\n\nShe makes a full cake, right then, and serves a slice to everyone in the bakery. For the first time in fifteen years, the recipe is complete. She writes *Perkins alpine* in the blank on the card and pins it back above the register.`,
    mystery_update: { mystery_id: 'missing_recipe', resolved: true },
    trust_update: { citizen_id: 'marigold_osei', new_level: trustLevel + 2 },
    journal_entry: {
      id: '',
      entry_type: 'mystery_clue',
      title: 'The Honey Cake Mystery — Solved',
      content: "The missing ingredient in Mari's grandmother's recipe was Perkins alpine honey, from Agnes Perkins's high-orchard hive.",
      related_id: 'missing_recipe',
      game_date: world.game_date,
      created_at: new Date().toISOString(),
    },
  }
}

// ── EXAMINE ───────────────────────────────────────────────────────────────────

async function handleExamine(
  supabase: SupabaseClient,
  command: ParsedCommand,
  session: GameSession
): Promise<GameResponse> {
  const target = command.target?.toLowerCase()
  if (!target) return handleInventory(session)

  const item = await findItemByName(supabase, target, session.currentLocation)
  if (!item) {
    return { text: `You don't see ${command.target} to examine closely.` }
  }

  let text = `**${item.name}** — examined closely:\n\n${item.description}`
  if (item.readable_content) {
    text += `\n\n---\n\n*Reading:* ${item.readable_content}`
  }
  if (item.lore_note) {
    text += `\n\n*${item.lore_note}*`
  }

  // Persist seen state to DB so it survives across sessions and devices
  await markItemSeen(supabase, session, item.id)

  return {
    text,
    seen_item_id: item.id,
    mystery_update: item.mystery_tie
      ? await checkMysteryClue(supabase, session, item.id, item.mystery_tie)
      : undefined,
    journal_entry: item.mystery_tie ? {
      id: '',
      entry_type: 'mystery_clue',
      title: `Examined: ${item.name}`,
      content: item.lore_note ?? item.description,
      related_id: item.mystery_tie,
      game_date: null,
      created_at: new Date().toISOString(),
    } : undefined,
  }
}

// ── RESEARCH ─────────────────────────────────────────────────────────────────

async function handleResearch(
  supabase: SupabaseClient,
  command: ParsedCommand,
  session: GameSession
): Promise<GameResponse> {
  // Must be at the library
  if (session.currentLocation !== 'library' && session.currentLocation !== 'library_archive_room') {
    return {
      text: "The research system is available at the Brindlewick Public Library. Eleanor and Juni would be happy to help you there.",
    }
  }

  const query = command.target
  if (!query) {
    return {
      text: "What would you like to research? The library catalogue covers town history, citizens, events, and local lore.\n\nTry: *research Mira Finch* or *research the lake light* or *research Alderman Finch*",
    }
  }

  // Search across research subjects by partial match on subject name
  const { data: subjects } = await supabase
    .from('research_subjects')
    .select(`id, subject, research_results(*)`)
    .ilike('subject', `%${query}%`)
    .limit(3)

  if (!subjects?.length) {
    return {
      text: `The library catalogue has no records matching "${query}". Eleanor might suggest related terms — you could ask her.`,
    }
  }

  const results = subjects[0]
  const availableResults = (results.research_results as Array<{
    id: string; title: string; source_label: string;
    content: string; mystery_tie: string | null; requires_condition: string | null
  }>)
    .filter(r => !r.requires_condition)
    .slice(0, 3)

  if (!availableResults.length) {
    return {
      text: `The catalogue shows records for "${results.subject as string}" but they require additional context to access. Eleanor may be able to help you further.`,
    }
  }

  // Show what we actually matched if the query differed from the subject name
  const matchedSubject = results.subject as string
  const headerNote = matchedSubject.toLowerCase() !== query.toLowerCase()
    ? `*(Searching for "${query}" — found records on: ${matchedSubject})*\n\n`
    : ''

  let text = `**Research: ${matchedSubject}**\n\n${headerNote}`
  for (const result of availableResults) {
    text += `**${result.title}**\n*Source: ${result.source_label}*\n${result.content}\n\n---\n\n`
  }

  const mysteryTies = availableResults.filter(r => r.mystery_tie).map(r => r.mystery_tie!)

  return {
    text: text.trimEnd(),
    mystery_update: mysteryTies[0]
      ? await checkMysteryClue(supabase, session, `research_${query}`, mysteryTies[0])
      : undefined,
    journal_entry: {
      id: '',
      entry_type: 'lore_discovered',
      title: `Research: ${results.subject as string}`,
      content: availableResults[0].content.slice(0, 200) + '...',
      related_id: mysteryTies[0] ?? null,
      game_date: null,
      created_at: new Date().toISOString(),
    },
  }
}

// ── JOURNAL ──────────────────────────────────────────────────────────────────

async function handleJournal(
  supabase: SupabaseClient,
  session: GameSession
): Promise<GameResponse> {
  const table = session.playerId ? 'player_journal' : 'player_journal'
  const key = session.playerId ? 'player_id' : 'guest_token'
  const val = session.playerId ?? session.guestToken

  const { data: entries } = await supabase
    .from(table)
    .select('*')
    .eq(key, val)
    .order('created_at', { ascending: false })
    .limit(20)

  if (!entries?.length) {
    return {
      text: "Your journal is empty so far. Explore Brindlewick — as you discover things, meet people, and find clues, they'll be recorded here automatically.",
    }
  }

  const grouped: Record<string, typeof entries> = {}
  for (const entry of entries) {
    const type = entry.entry_type as string
    grouped[type] = grouped[type] ?? []
    grouped[type].push(entry)
  }

  let text = "**Your Journal**\n\n"

  if (grouped['citizen_met']?.length) {
    text += `**People you've met** (${grouped['citizen_met'].length})\n`
    text += grouped['citizen_met'].slice(0, 5).map((e: { title: string }) => `• ${e.title}`).join('\n') + '\n\n'
  }

  if (grouped['mystery_clue']?.length) {
    text += `**Open threads** (${grouped['mystery_clue'].length})\n`
    text += grouped['mystery_clue'].slice(0, 5).map((e: { title: string }) => `• ${e.title}`).join('\n') + '\n\n'
  }

  if (grouped['lore_discovered']?.length) {
    text += `**Things you've learned** (${grouped['lore_discovered'].length})\n`
    text += grouped['lore_discovered'].slice(0, 3).map((e: { title: string }) => `• ${e.title}`).join('\n') + '\n\n'
  }

  if (grouped['task_completed']?.length) {
    text += `**Help given** (${grouped['task_completed'].length})\n`
    text += grouped['task_completed'].slice(0, 3).map((e: { title: string }) => `• ${e.title}`).join('\n')
  }

  return { text }
}

// ── INVENTORY ────────────────────────────────────────────────────────────────

async function handleInventory(session: GameSession): Promise<GameResponse> {
  if (!session.inventory.length) {
    return { text: "You're not carrying anything. Your pockets are pleasantly light." }
  }
  // Show item IDs formatted as readable names — item name fetch happens in sidebar
  const list = session.inventory.map(id => `• ${id.replace(/_/g, ' ')}`).join('\n')
  return { text: `**Carrying:**\n${list}\n\n*You can examine any of these for more detail.*` }
}

// ── HELP ─────────────────────────────────────────────────────────────────────

function handleHelp(command: ParsedCommand): GameResponse {
  return {
    text: `**How to play Brindlewick**

You're exploring a small mountain town by typing what you want to do. The game understands natural language, so don't worry about exact syntax.

**Moving around**
*go to the bakery* · *walk to lakeside park* · *head toward the library*

**Looking around**
*look around* · *look at the statue* · *examine the notice board*

**Talking to people**
*talk to Eleanor* · *speak with Harold* · *ask Mari about her recipe*

**Using things**
*take the almanac* · *read the almanac* · *use the honey on Mari*

**Research (at the library)**
*research Mira Finch* · *look up the lake light* · *find out about Alderman Finch*

**Checking your progress**
*journal* · *inventory* · *wait*

**Solving mysteries**
*solve the honey cake mystery* · *deduce the lake light* · *I think I've figured out the feud*
When you have enough clues, commit to an answer and see if you're right.

**Catching up**
*what happened* · *what did I miss* — summarizes recent town events
*recall Eleanor* · *what do I know about the lake* — your notes on a person or topic

**Time travel** *(requires the Chrono-Logbook from Eleanor)*
*travel to 1866* · *travel to the founding years* — visit any year in town history
*return to present* — return from the past to now
*look around* · *talk to [name]* · *ask [name] about [topic]* all work in the past

There are no wrong moves, no ways to fail, and no time pressure. Brindlewick will be here whenever you are.`,
  }
}

// ── WAIT ─────────────────────────────────────────────────────────────────────

async function handleWait(
  supabase: SupabaseClient,
  session: GameSession,
  world: { game_date: string; game_season: string },
  timeSlot: string
): Promise<GameResponse> {
  const location = await getLocation(supabase, session.currentLocation)  // A2: cached

  // Generic ambient lines used as prefix or fallback
  const ambients = [
    "A comfortable silence settles.",
    "You sit with the unhurried quality Brindlewick seems to encourage.",
    "Time passes gently. A bird crosses the sky.",
    "The light shifts by a degree or two.",
    "You rest a moment. There's no hurry here.",
  ]
  const ambient = ambients[Math.floor(Math.random() * ambients.length)]

  // Pull the location-specific time variant if available
  let locationDetail: string | null = null
  if (location) {
    const variantKey = `time_variant_${timeSlot === 'midday' ? 'afternoon' : timeSlot === 'early_morning' ? 'morning' : timeSlot}` as keyof typeof location
    locationDetail = (location[variantKey] as string | null) ?? null
  }

  const text = locationDetail
    ? `${ambient} ${locationDetail}`
    : ambient

  return { text }
}

// ── FIND ─────────────────────────────────────────────────────────────────────

async function handleFind(
  supabase: SupabaseClient,
  command: ParsedCommand,
  session: GameSession,
  world: { game_date: string; game_season: string },
  timeSlot: string
): Promise<GameResponse> {
  const target = command.target?.toLowerCase()
  if (!target) {
    return { text: "What are you looking for? Try: *where is the library* or *where is Eleanor*" }
  }

  // Check if it's a citizen first
  const citizen = await findCitizenByName(supabase, target)
  if (citizen) {
    // Use the DB RPC which handles exact-day > weekday/weekend > home fallback
    const { data: locationId } = await supabase.rpc('get_citizen_location', {
      p_citizen_id: citizen.id,
      p_game_date: world.game_date,
      p_time_slot: timeSlot,
    })

    if (locationId) {
      const loc = await getLocation(supabase, locationId as string)  // A2: cached

      const locationName = loc?.name ?? (locationId as string).replace(/_/g, ' ')
      const area = loc?.area ? ` (${loc.area})` : ''
      return {
        text: `${citizen.first_name} ${citizen.last_name} is usually at **${locationName}**${area} around this time of day.`,
      }
    }

    return {
      text: `${citizen.first_name} ${citizen.last_name} doesn't seem to have a fixed spot at this hour. You might find them by wandering and keeping an eye out.`,
    }
  }

  // Try as a location
  const destination = await findLocationByName(supabase, target)
  if (!destination) {
    return {
      text: `You haven't heard of anywhere called "${command.target}" in Brindlewick. Looking around and talking to townsfolk is often the best way to discover new places.`,
    }
  }

  // Find a path hint from current location
  const { data: directExit } = await supabase
    .from('location_exits')
    .select('to_loc')
    .eq('from_loc', session.currentLocation)
    .eq('to_loc', destination.id)
    .eq('blocked', false)
    .single()

  if (directExit) {
    return {
      text: `**${destination.name}** is just a short walk from here. You can go there directly.`,
    }
  }

  // Find a one-hop intermediate
  const { data: myExits } = await supabase
    .from('location_exits')
    .select('to_loc')
    .eq('from_loc', session.currentLocation)
    .eq('blocked', false)

  const myExitIds = (myExits ?? []).map((e: { to_loc: string }) => e.to_loc)

  const { data: nextHop } = await supabase
    .from('location_exits')
    .select('from_loc, locations!from_loc(name)')
    .eq('to_loc', destination.id)
    .eq('blocked', false)
    .in('from_loc', myExitIds)
    .limit(1)
    .single()

  if (nextHop) {
    const viaName = (nextHop.locations as unknown as { name: string } | null)?.name ?? nextHop.from_loc
    return {
      text: `**${destination.name}** is in the ${destination.area ?? 'town'} area. Head toward **${viaName}** first, then continue on from there.`,
    }
  }

  // Generic area hint
  return {
    text: `**${destination.name}** is somewhere in the ${destination.area ?? 'town'} area. Asking a local or exploring from the town square is a good way to find it.`,
  }
}

// ── CATCH UP ─────────────────────────────────────────────────────────────────

async function handleCatchUp(
  supabase: SupabaseClient,
  session: GameSession,
  world: { game_date: string; game_season: string }
): Promise<GameResponse> {
  // Get last 7 game days of world events — gives a meaningful catch-up window
  const since = new Date(world.game_date)
  since.setDate(since.getDate() - 7)
  const sinceStr = since.toISOString().slice(0, 10)

  const { data: events } = await supabase
    .from('world_events')
    .select('game_date, event_type, headline, detail, is_major')
    .gte('game_date', sinceStr)
    .lte('game_date', world.game_date)
    .order('game_date', { ascending: false })
    .limit(20)

  if (!events?.length) {
    return {
      text: "The town has been quietly itself while you were away — nothing remarkable to report. Brindlewick has that quality.",
    }
  }

  // Separate major from minor
  const major = events.filter((e: { is_major: boolean }) => e.is_major)
  const minor = events.filter((e: { is_major: boolean }) => !e.is_major)

  let text = "**What's been happening in Brindlewick**\n\n"

  if (major.length) {
    text += "**Notable developments:**\n"
    for (const e of major.slice(0, 5)) {
      const date = new Date(e.game_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      text += `• *${date}* — ${e.headline}`
      if (e.detail) text += ` ${e.detail}`
      text += '\n'
    }
    text += '\n'
  }

  if (minor.length) {
    text += "**Smaller things:**\n"
    for (const e of minor.slice(0, 3)) {
      text += `• ${e.headline}\n`
    }
    text += '\n'
  }

  text += `*The Chronicle tab in the sidebar shows the full town history.*`

  return { text }
}

// ── RECALL ────────────────────────────────────────────────────────────────────

async function handleRecall(
  supabase: SupabaseClient,
  command: ParsedCommand,
  session: GameSession
): Promise<GameResponse> {
  const target = command.target?.toLowerCase()
  if (!target) {
    return { text: "Recall what? Try: *recall Eleanor* or *what do I know about the lake*" }
  }

  const key = session.playerId ? 'player_id' : 'guest_token'
  const val = session.playerId ?? session.guestToken

  // Try citizen match first
  const citizen = await findCitizenByName(supabase, target)
  if (citizen) {
    const fullName = `${citizen.first_name} ${citizen.last_name}`

    // Get trust level
    const trustLevel = await getTrustLevel(supabase, session, citizen.id)

    // Get all journal entries related to this citizen
    const { data: entries } = await supabase
      .from('player_journal')
      .select('entry_type, title, content, created_at')
      .eq(key, val)
      .or(`related_id.eq.${citizen.id},title.ilike.%${citizen.first_name}%`)
      .order('created_at', { ascending: false })
      .limit(10)

    if (!entries?.length) {
      return {
        text: `You haven't written anything about ${fullName} yet. Talk to them to learn more.`,
      }
    }

    const trustLabel = ['stranger', 'acquaintance', 'friendly', 'trusted', 'close friend'][trustLevel] ?? 'known'

    let text = `**${fullName}**\n`
    text += `*${citizen.occupation ?? 'Resident'} · ${trustLabel}*\n\n`

    if (citizen.appearance) text += `${citizen.appearance}\n\n`

    text += '**What you know:**\n'
    for (const entry of entries.slice(0, 6)) {
      const label = entry.entry_type === 'citizen_met' ? 'First meeting'
        : entry.entry_type === 'task_completed' ? 'Helped with'
        : entry.entry_type === 'lore_discovered' ? 'Learned'
        : 'Note'
      text += `• *${label}:* ${entry.content.slice(0, 120)}${entry.content.length > 120 ? '…' : ''}\n`
    }

    return { text }
  }

  // Try as a mystery or topic — pull lore_discovered entries
  const { data: loreEntries } = await supabase
    .from('player_journal')
    .select('entry_type, title, content, created_at')
    .eq(key, val)
    .or(`title.ilike.%${target}%,content.ilike.%${target}%`)
    .in('entry_type', ['lore_discovered', 'mystery_clue'])
    .order('created_at', { ascending: false })
    .limit(5)

  if (loreEntries?.length) {
    let text = `**What you know about "${command.target}":**\n\n`
    for (const entry of loreEntries) {
      text += `• **${entry.title}**\n  ${entry.content.slice(0, 200)}\n\n`
    }
    return { text }
  }

  return {
    text: `Your journal doesn't have any notes about "${command.target}" yet. Keep exploring — Brindlewick reveals things slowly.`,
  }
}

// ── TRAVEL ───────────────────────────────────────────────────────────────────

async function handleTravel(
  supabase: SupabaseClient,
  command: ParsedCommand,
  session: GameSession,
  world: { game_date: string; game_season: string }
): Promise<GameResponse> {
  // Must have the Chrono-Logbook
  if (!session.hasChronoLogbook) {
    return {
      text: `You don't have a way to travel through time. This is something Eleanor Finch might know about — if she trusts you enough to share it.`,
    }
  }

  const rawTarget = command.target ?? command.qualifier ?? ''
  const parsed = parseTravelTarget(rawTarget)

  if (!parsed) {
    return {
      text: `The Chrono-Logbook needs a specific time to travel to. Try a year: *travel to 1866* or *travel to the founding years*.`,
    }
  }

  // Validate range
  const targetYear = new Date(parsed.date).getFullYear()
  const currentYear = new Date().getFullYear()

  if (targetYear < TOWN_FOUNDING_YEAR) {
    return {
      text: `The Chrono-Logbook opens to a blank page. ${targetYear} predates the town's founding in 1809 — there's nothing here to visit yet.`,
    }
  }

  if (targetYear > currentYear) {
    return {
      text: `The Chrono-Logbook's pages thin and then stop. It won't take you into a future that hasn't happened yet.`,
    }
  }

  // Set time position
  await setTimePosition(supabase, session, parsed.date)

  const timePeriod = await getTimePeriodForDate(supabase, parsed.date)
  const dateLabel = formatHistoricalDate(parsed.date)

  // Get historical description of current location
  const result = await getLocationWithExits(supabase, session.currentLocation)
  const location = result?.location

  let desc = ''
  if (timePeriod && location) {
    const histData = await getHistoricalLocationDescription(supabase, location.id, timePeriod.id)
    desc = histData?.description ?? `You find yourself in ${location.name}, though it looks quite different from what you know.`

    const histCitizens = await getHistoricalCitizensAt(supabase, location.id, timePeriod.id)
    if (histCitizens.length > 0) {
      const names = histCitizens.map(c => `${c.first_name} ${c.last_name}`).join(', ')
      desc += `\n\nPresent: ${names}.`
    }

    const histItems = await getHistoricalItemsAt(supabase, location.id, timePeriod.id)
    if (histItems.length > 0) {
      desc += `\n\nYou notice: ${histItems.map(i => i.name).join(', ')}.`
    }

    if (histData?.special_note) {
      desc += `\n\n*${histData.special_note}*`
    }
  }

  const eraName = timePeriod?.name ?? parsed.displayName
  const atmosphere = timePeriod?.atmosphere

  let text = `The Chrono-Logbook shimmers and the world shifts.\n\n**${dateLabel}** — *${eraName}*\n\n`
  if (atmosphere) text += `${atmosphere}\n\n`
  if (desc) text += desc
  if (!desc) text += `You are in ${location?.name ?? 'an unfamiliar place'}, though it looks quite different from what you know.`
  text += `\n\n*Type* return to present *when you're ready to come back. What you learn here may change what you find there.*`

  // Log journal entry
  return {
    text,
    journal_entry: {
      id: '',
      entry_type: 'event_witnessed',
      title: `Traveled to ${dateLabel}`,
      content: `Visited Brindlewick in ${dateLabel} using the Chrono-Logbook. ${eraName}.`,
      related_id: null,
      game_date: world.game_date,
      created_at: new Date().toISOString(),
    },
  }
}

// ── RETURN TO PRESENT ────────────────────────────────────────────────────────

async function handleReturnPresent(
  supabase: SupabaseClient,
  session: GameSession,
  world: { game_date: string; game_season: string },
  timeSlot: string
): Promise<GameResponse> {
  if (!session.timePosition) {
    return {
      text: "You're already in the present. The town is exactly as you left it.",
    }
  }

  const departedFrom = formatHistoricalDate(session.timePosition)

  // Clear time position
  await setTimePosition(supabase, session, null)

  // Load any temporal changes the player made
  const temporalChanges = await getPlayerTemporalChanges(supabase, session)
  const recentChanges = temporalChanges.filter(c => c.change_date === session.timePosition)

  // Describe the return
  let text = `The Chrono-Logbook closes. The world resolves back into the present — your present.\n\n`

  if (recentChanges.length > 0) {
    text += `**Something has changed.**\n\n`
    for (const change of recentChanges) {
      text += `${change.effect_present}\n\n`
    }
  } else {
    text += `Brindlewick is as you left it, though you carry something new: knowledge of what was.\n\n`
  }

  // Add present description
  const result = await getLocationWithExits(supabase, session.currentLocation)
  if (result) {
    const { location } = result
    const desc = getLocationDescription(location, world.game_season, timeSlot)
    text += `**${location.name}**\n\n${desc}`

    // Add temporal change effects to the location description
    const locationChanges = temporalChanges.filter(
      c => c.target_type === 'location' && c.target_id === location.id
    )
    if (locationChanges.length > 0) {
      for (const lc of locationChanges) {
        text += `\n\n*${lc.effect_present}*`
      }
    }
  }

  return {
    text,
    journal_entry: {
      id: '',
      entry_type: 'event_witnessed',
      title: `Returned from ${departedFrom}`,
      content: recentChanges.length > 0
        ? `Your visit to ${departedFrom} changed things: ${recentChanges.map(c => c.effect_present).join(' ')}`
        : `Returned from ${departedFrom} with knowledge of the past.`,
      related_id: null,
      game_date: world.game_date,
      created_at: new Date().toISOString(),
    },
  }
}

// ── ELEANOR QUEST CHAIN ───────────────────────────────────────────────────────

/**
 * Eleanor's trust-gated quest chain — she reveals her secrets as the player
 * builds a relationship with her, and eventually gives the Chrono-Logbook.
 *
 * Trust 0 → warm but professional
 * Trust 1 → hints about her unusual knowledge
 * Trust 2 → unlocks archive access
 * Trust 3 → confesses the "Dear Neighbor" column + mentions a device
 * Trust 4 → gives the Chrono-Logbook + recruits player as next historian
 */
async function handleEleanorQuestProgress(
  supabase: SupabaseClient,
  session: GameSession,
  citizen: Citizen,
  trustLevel: number
): Promise<string | null> {
  if (citizen.id !== 'eleanor_finch_hartwell') return null
  if (trustLevel < 1) return null

  // Trust 1: hint about her deep knowledge
  if (trustLevel === 1) {
    return `Eleanor straightens the stack of papers she's been organizing and looks at you steadily.\n\n"You're curious," she says. "That's good. Most visitors want things explained quickly. The people who understand Brindlewick are the ones who let it explain itself slowly."\n\nShe pauses. "Come back when you've seen more of the town. I find I tell people more after I've had time to think about them."`
  }

  // Trust 2: archive access, she starts being a little more open
  if (trustLevel === 2) {
    return `Eleanor comes out from behind the desk, which she rarely does.\n\n"I want to show you something," she says. She leads you to the archive room door and unlocks it with a key from her cardigan pocket. Inside: floor-to-ceiling shelves of bound correspondence, maps, ledgers. The air smells of very old paper and something like cedar.\n\n"Everything that ever happened in this town is in here," she says. "Or everything that was written down, which is most of it."\n\nShe looks at you. "You can research here when I'm in the building. Not everything is catalogued yet." A pause. "Actually, I could use help with that."`
  }

  // Trust 3: the Dear Neighbor confession + hint about the logbook
  if (trustLevel === 3) {
    return `Eleanor is quiet for longer than usual after you sit down.\n\n"You may have noticed I know more about this town's history than seems reasonable," she says finally. "People have mentioned it. I've been the librarian for forty-two years and I have read — everything. But that's not all of it."\n\nShe takes a breath. "The 'Dear Neighbor' column. The one that's run in the valley paper for forty-two years. That's me. All of it. I thought you should know."\n\nAnother pause. "There's something else I want to show you, but I'm not quite ready yet. Come back. I'm deciding whether I trust you with something rather unusual."`
  }

  // Trust 4: give the Chrono-Logbook
  if (trustLevel >= 4) {
    // Check if player already has it
    if (session.hasChronoLogbook) return null

    await grantChronoLogbook(supabase, session)

    return `Eleanor opens a drawer in the archive desk — not the usual drawer, a different one, lower, that you hadn't noticed — and takes out a small book. It is bound in dark green leather, old but well-cared-for, and it has a clock-face embossed on the cover with hands that seem to move slightly when you look at it from the corner of your eye.\n\n"I'm the town historian," Eleanor says. "I have been for forty-two years, and before me my mother, and before her, her mother. We've kept this." She sets the book on the desk between you. "The Chrono-Logbook. Open it to a date and you'll be there. 1809 through today — anywhere in the town's history."\n\nShe looks at you over her glasses. "The rule is: don't change anything important. Small things are fine — actually, small things sometimes fix larger problems. You'll understand when you're in it."\n\nA pause. "I'm asking you to be the next historian. I won't be here forever, and this book goes to someone, or it goes nowhere." She pushes it toward you. "Your job is to know the town's stories. All of them. Even the ones it's been keeping for a hundred and fifty years."\n\n*You are now carrying the Chrono-Logbook. Type* travel to [year] *to visit any date from 1809 to the present.*`
  }

  return null
}

// ── GIVE ─────────────────────────────────────────────────────────────────────

/**
 * Unified give handler — routes to gift-to-NPC or request-from-NPC
 * based on command shape.
 *
 * "give X to Y" / "offer X to Y"  → player gifts item to NPC
 * "give me X" / "get X from Y"    → player requests item from NPC
 * "accept" / "yes, take it"        → player accepts pending offer
 */
async function handleGive(
  supabase: SupabaseClient,
  command: ParsedCommand,
  session: GameSession,
  world: { game_date: string; game_season: string },
  timeSlot: string
): Promise<GameResponse> {
  const rawTarget = command.target?.toLowerCase() ?? ''
  const rawQualifier = command.qualifier?.toLowerCase() ?? ''

  // ── Detect direction: "give X to Y" means player → NPC ───────────────────
  // Pattern: "give <item> to <citizen>" — qualifier is the citizen, target is item
  // We detect this when the raw command starts with "give/offer/hand/present"
  // and the qualifier doesn't look like an encoded offer (no ':')
  const rawCmd = command.raw.trim().toLowerCase()
  const isGiftToNpc = /^(?:give|offer|hand|present)\s+/.test(rawCmd) &&
    rawQualifier && !rawQualifier.includes(':') &&
    !/^(?:give me|give .+ to me)/.test(rawCmd)

  if (isGiftToNpc) {
    // target = item name, qualifier = citizen name
    return handleGiftToNpc(supabase, session, command, world, timeSlot)
  }

  // ── Case 1: accepting a pending offer (bare "accept" / "yes, take it") ────
  // The qualifier carries "citizenId:itemId" encoded by the frontend
  if (!rawTarget || /^(?:accept|yes|take it)/.test(command.raw.trim().toLowerCase())) {
    if (rawQualifier && rawQualifier.includes(':')) {
      const [citizenId, itemId] = rawQualifier.split(':')
      const result = await acceptNpcOffer(supabase, session, citizenId, itemId)
      if (result.transferred && result.item) {
        const newInventory = [...session.inventory, result.item.id]
        return {
          text: `You take **${result.item.name}**.`,
          inventory_update: newInventory,
        }
      }
      return { text: "The offer seems to have passed — they're no longer holding that." }
    }
    return { text: "Accept what? Talk to someone first to see what they might offer you." }
  }

  // ── Case 2 & 3: find the item + citizen ──────────────────────────────────
  // Determine which citizen is being addressed
  let targetCitizenId: string | null = null
  const itemQuery = rawTarget

  if (rawQualifier) {
    // "get <item> from <citizen>" → qualifier is the citizen name
    const citizen = await findCitizenByName(supabase, rawQualifier)
    if (citizen) targetCitizenId = citizen.id
    // item query stays as rawTarget
  }

  // Get citizens at current location
  const citizens = await getCitizensAtLocation(supabase, session.currentLocation, world.game_date, timeSlot)

  // If citizen specified, verify they're here
  if (targetCitizenId) {
    const isHere = citizens.some(c => c.id === targetCitizenId)
    if (!isHere) {
      const citizen = await getCitizen(supabase, targetCitizenId)
      return {
        text: `${citizen?.first_name ?? 'That person'} isn't here right now.`,
      }
    }
  }

  // Search for the item among NPCs at this location
  const candidateCitizenIds = targetCitizenId
    ? [targetCitizenId]
    : citizens.map(c => c.id)

  for (const citizenId of candidateCitizenIds) {
    const holdings = await getCitizenHoldings(supabase, citizenId)
    const match = holdings.find(i =>
      i.name.toLowerCase().includes(itemQuery) ||
      i.id.toLowerCase().includes(itemQuery.replace(/\s+/g, '_'))
    )

    if (match) {
      // Found the item — try on_ask behaviors
      const { offers, immediateGifts } = await processInteractionBehaviors(
        supabase, session, citizenId, session.currentLocation, 'on_ask', match.id
      )

      if (immediateGifts.length > 0) {
        const gift = immediateGifts[0]
        const newInventory = [...session.inventory, match.id]
        return {
          text: gift.narrativeHint ?? `You receive **${match.name}**.`,
          inventory_update: newInventory,
          journal_entry: {
            id: '',
            entry_type: 'item_found',
            title: `Received: ${match.name}`,
            content: match.description,
            related_id: match.id,
            game_date: world.game_date,
            created_at: new Date().toISOString(),
          },
        }
      }

      if (offers.length > 0) {
        return {
          text: offers[0].dialogueHint,
          pending_npc_offer: offers[0],
        }
      }

      // NPC has the item but no behavior allows giving it
      const citizen = await getCitizen(supabase, citizenId)
      return {
        text: `${citizen?.first_name ?? 'They'} doesn't seem willing to part with ${match.name} right now.`,
      }
    }
  }

  // Item not found on any NPC here
  if (citizens.length === 0) {
    return { text: "There's no one here who might have that." }
  }
  return { text: `Nobody here seems to have ${command.target ?? 'that'}.` }
}

// ── GIFT TO NPC ───────────────────────────────────────────────────────────────

/**
 * Player gives an item from their inventory to an NPC.
 *
 * Steps:
 * 1. Find the item in inventory
 * 2. Find the citizen at this location
 * 3. Look up citizen's impression_category preference for this item
 * 4. Calculate effective trust delta (impression_value * preference_multiplier)
 * 5. Remove from inventory, add to citizen_item_holdings
 * 6. Generate NPC reaction via Claude (using dialogue_hint from preferences)
 * 7. Apply trust delta, log the gift
 */
async function handleGiftToNpc(
  supabase: SupabaseClient,
  session: GameSession,
  command: ParsedCommand,
  world: { game_date: string; game_season: string },
  timeSlot: string
): Promise<GameResponse> {
  const itemQuery    = command.target?.toLowerCase() ?? ''
  const citizenQuery = command.qualifier?.toLowerCase() ?? ''

  if (!itemQuery) return { text: 'Give what?' }
  if (!citizenQuery) return { text: 'Give it to whom?' }

  // Find item in inventory
  const carriedId = session.inventory.find(id => {
    const normalized = id.toLowerCase().replace(/_/g, ' ')
    return normalized.includes(itemQuery) || itemQuery.includes(normalized)
  })

  let item = carriedId ? await getItem(supabase, carriedId) : null

  // Try name match if ID match failed
  if (!item) {
    const allCarried = await Promise.all(session.inventory.map(id => getItem(supabase, id)))
    item = allCarried.find(i => i && i.name.toLowerCase().includes(itemQuery)) ?? null
  }

  if (!item) {
    return { text: `You're not carrying anything called "${command.target}".` }
  }

  // Find citizen at current location
  const citizens = await getCitizensAtLocation(supabase, session.currentLocation, world.game_date, timeSlot)
  const citizen = citizens.find(c =>
    `${c.first_name} ${c.last_name}`.toLowerCase().includes(citizenQuery) ||
    c.first_name.toLowerCase().includes(citizenQuery) ||
    (c.nickname?.toLowerCase() ?? '').includes(citizenQuery)
  )

  if (!citizen) {
    const anywhere = await findCitizenByName(supabase, citizenQuery)
    if (anywhere) {
      return { text: `${anywhere.first_name} isn't here right now.` }
    }
    return { text: `There's no one called "${command.qualifier}" here.` }
  }

  // Look up this citizen's preference for this item's impression category
  const { data: pref } = await supabase
    .from('citizen_item_preferences')
    .select('*')
    .eq('citizen_id', citizen.id)
    .eq('impression_category', item.impression_category ?? 'neutral')
    .maybeSingle()

  const multiplier = (pref?.preference_multiplier as number | null) ?? 1.0
  const rawDelta = (item.impression_value ?? 0) * multiplier
  // Clamp to reasonable range and round to one decimal
  const trustDelta = Math.max(-2, Math.min(2, Math.round(rawDelta * 10) / 10))

  // Pick the right reaction text
  const liked = rawDelta >= 0
  const reactionHint = liked
    ? (pref?.reaction_positive as string | null)
    : (pref?.reaction_negative as string | null)

  // Generate NPC reaction via Claude if no scripted hint, or use the hint directly
  let reactionText: string
  if (reactionHint) {
    reactionText = reactionHint
  } else {
    // Fall back to Claude-generated reaction
    const roster = await getTownRoster(supabase)
    const trustLevel = await getTrustLevel(supabase, session, citizen.id)
    const giftTopic = `The player has just given you the following item as a gift: "${item.name}" (${item.description}). The item makes a ${liked ? 'positive' : 'negative'} impression (value: ${item.impression_value ?? 0}). React naturally in 1-2 sentences. Do not add quotation marks around the whole response — just write what you say or do.`
    reactionText = await generateNpcDialogue(supabase, citizen, trustLevel, giftTopic, session, roster, [])
  }

  // Remove item from inventory
  const newInventory = session.inventory.filter(id => id !== item!.id)
  const saveTable = session.playerId ? 'player_saves' : 'guest_saves'
  const saveKey   = session.playerId ? 'player_id'   : 'session_token'
  const saveVal   = session.playerId ?? session.guestToken
  await supabase.from(saveTable).update({ inventory: newInventory }).eq(saveKey, saveVal)

  // Add to citizen's holdings
  await supabase.from('citizen_item_holdings').upsert({
    citizen_id: citizen.id,
    item_id: item.id,
    acquired_from_type: 'citizen',
    acquired_from_id: 'player',
    acquired_at: new Date().toISOString(),
  }, { onConflict: 'citizen_id,item_id' })

  // Apply trust delta
  const currentTrust = await getTrustLevel(supabase, session, citizen.id)
  const newTrust = trustDelta !== 0
    ? await updateTrust(supabase, session, citizen.id, currentTrust, trustDelta)
    : currentTrust

  // Log the gift
  const pgiKey = session.playerId ? 'player_id' : 'guest_token'
  const pgiVal = session.playerId ?? session.guestToken
  await supabase.from('player_given_items').insert({
    [pgiKey]: pgiVal,
    item_id: item.id,
    citizen_id: citizen.id,
    trust_delta: trustDelta,
  })

  const deltaNote = trustDelta > 0
    ? `\n\n*Your relationship with ${citizen.first_name} has warmed slightly.*`
    : trustDelta < -0.5
    ? `\n\n*${citizen.first_name} seems less warmly disposed toward you.*`
    : ''

  return {
    text: `You give **${item.name}** to ${citizen.first_name}.\n\n${reactionText}${deltaNote}`,
    inventory_update: newInventory,
    trust_update: trustDelta !== 0 ? { citizen_id: citizen.id, new_level: newTrust } : undefined,
  }
}

// ── SOLVE ─────────────────────────────────────────────────────────────────────

/**
 * Handle a solve/deduce attempt. The player has gathered clues and believes
 * they know the answer to a mystery. We check which mystery they mean, verify
 * they have enough clues, and show the resolution if they do.
 *
 * Works in two modes:
 *   "I've worked out the honey cake mystery" → identify + attempt
 *   "solve" (bare) → list active mysteries and prompt
 */
async function handleSolve(
  supabase: SupabaseClient,
  command: ParsedCommand,
  session: GameSession
): Promise<GameResponse> {
  const key = session.playerId ? 'player_id' : 'guest_token'
  const val = session.playerId ?? session.guestToken

  // Try to identify the mystery from the player's input
  const mysteryId = await findMysteryByInput(supabase, command.raw)

  if (!mysteryId) {
    // No mystery identified — list active ones and invite
    const { data: progress } = await supabase
      .from('player_mystery_progress')
      .select('mystery_id, mysteries(title)')
      .eq(key, val)
      .eq('is_resolved', false)

    if (!progress?.length) {
      return {
        text: "You don't have any open mysteries yet. Explore, talk to people, and gather clues — they'll appear in your journal.",
      }
    }

    const titles = progress
      .map((p: { mystery_id: string; mysteries: unknown }) => {
        const m = p.mysteries as { title?: string } | Array<{ title?: string }>
        const title = Array.isArray(m) ? m[0]?.title : m?.title
        return `• ${title ?? p.mystery_id}`
      })
      .join('\n')

    return {
      text: `Which mystery are you working on? Your open threads:\n\n${titles}\n\n*Try: "I think I've solved the honey cake mystery" or "deduce the lake light"*`,
    }
  }

  const result = await handleSolveAttempt(supabase, session, mysteryId)

  return {
    text: result.text,
    mystery_update: result.success ? { mystery_id: mysteryId, resolved: true } : undefined,
    journal_entry: result.success
      ? {
          id: '',
          entry_type: 'mystery_clue',
          title: 'Mystery resolved',
          content: result.text.replace(/\*[^*]+\*/g, '').trim().slice(0, 300),
          related_id: mysteryId,
          game_date: null,
          created_at: new Date().toISOString(),
        }
      : undefined,
  }
}

// ── UNKNOWN ───────────────────────────────────────────────────────────────────

function handleUnknown(command: ParsedCommand): GameResponse {
  const suggestions = [
    "You could *look around* to see what's here.",
    "Try *look around* or *go somewhere* or *talk to someone*.",
    "Not sure what to do? Type *help* for a quick guide.",
  ]
  const suggestion = suggestions[Math.floor(Math.random() * suggestions.length)]

  return {
    text: `Hmm, you're not quite sure how to do that. ${suggestion}`,
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Log a player interaction (talk, ask, examine, etc.) to player_interactions.
 * This feeds the memory system and NPC recall.
 */
async function logInteraction(
  supabase: SupabaseClient,
  session: GameSession,
  data: {
    citizen_id?: string
    location_id?: string
    item_id?: string
    interaction_type: string
    topic?: string
    summary?: string
    time_position?: string
  }
): Promise<void> {
  try {
    // A6: the game date comes from the real ET clock — no world_state read needed
    const world = await getWorldState(supabase)

    await supabase.from('player_interactions').insert({
      player_id: session.playerId,
      guest_token: session.guestToken,
      citizen_id: data.citizen_id ?? null,
      location_id: data.location_id ?? null,
      item_id: data.item_id ?? null,
      interaction_type: data.interaction_type,
      topic: data.topic ?? null,
      summary: data.summary ?? null,
      game_date: world.game_date ?? null,
      time_position: data.time_position ?? session.timePosition ?? null,
    })

    // Update citizen conversation memory if this was a citizen interaction
    if (data.citizen_id) {
      const key = session.playerId ? 'player_id' : 'guest_token'
      const val = session.playerId ?? session.guestToken

      const { data: existing } = await supabase
        .from('citizen_conversation_memory')
        .select('id, interaction_count, topics_discussed')
        .eq(key, val)
        .eq('citizen_id', data.citizen_id)
        .maybeSingle()

      if (existing) {
        const topics = existing.topics_discussed as string[]
        const newTopics = data.topic && !topics.includes(data.topic)
          ? [...topics, data.topic]
          : topics
        await supabase
          .from('citizen_conversation_memory')
          .update({
            interaction_count: existing.interaction_count + 1,
            topics_discussed: newTopics,
            last_interaction: new Date().toISOString(),
          })
          .eq('id', existing.id)
      } else {
        await supabase.from('citizen_conversation_memory').insert({
          [key]: val,
          citizen_id: data.citizen_id,
          interaction_count: 1,
          topics_discussed: data.topic ? [data.topic] : [],
          first_met_at: new Date().toISOString(),
          last_interaction: new Date().toISOString(),
        })
      }
    }
  } catch {
    // Non-critical — don't fail the command if logging fails
  }
}

/**
 * Log a location visit. Returns true if this was the player's FIRST visit
 * (A8: determined from the pre-existing row check it already performs, so
 * callers no longer need a separate query — which also fixes the bug where
 * the first-visit check ran after the insert and always came back false).
 */
async function logLocationVisit(
  supabase: SupabaseClient,
  session: GameSession,
  locationId: string
): Promise<boolean> {
  const key = session.playerId ? 'player_id' : 'guest_token'
  const val = session.playerId ?? session.guestToken

  // Use select+update rather than upsert — partial unique indexes (migration 002)
  // avoid the conflict ambiguity between (player_id, location_id) and (guest_token, location_id)
  const { data: existing } = await supabase
    .from('player_location_visits')
    .select('id, visit_count')
    .eq(key, val)
    .eq('location_id', locationId)
    .maybeSingle()

  if (existing) {
    await supabase
      .from('player_location_visits')
      .update({ visit_count: existing.visit_count + 1, last_visited: new Date().toISOString() })
      .eq('id', existing.id)
    return false
  } else {
    await supabase
      .from('player_location_visits')
      .insert({ [key]: val, location_id: locationId, visit_count: 1 })
    return true
  }
}

/**
 * Check whether completing an action triggers completion of any player task.
 * trigger can be 'talked_to', 'took_item', 'visited_location', or 'used_item'.
 * Returns a completion message if a task was just finished, or null.
 */
async function checkTaskCompletion(
  supabase: SupabaseClient,
  session: GameSession,
  trigger: string,
  triggerId: string
): Promise<string | null> {
  const key = session.playerId ? 'player_id' : 'guest_token'
  const val = session.playerId ?? session.guestToken

  // Only complete tasks the player has explicitly accepted (in_progress)
  const { data: playerTasks } = await supabase
    .from('player_task_progress')
    .select('task_id, status')
    .eq(key, val)
    .eq('status', 'in_progress')

  if (!playerTasks?.length) return null

  const taskIds = playerTasks.map((t: { task_id: string }) => t.task_id)

  // Tasks complete when the player is at the task's location_req (or location_req is null).
  // Both 'visited_location' and 'took_item' triggers check the current/target location.
  const checkLocationId = trigger === 'visited_location' ? triggerId : session.currentLocation
  const { data: completable } = await supabase
    .from('help_tasks')
    .select('id, title, reward_lore, trust_gain, giver_citizen, mystery_reveals')
    .in('id', taskIds)
    .or(`location_req.is.null,location_req.eq.${checkLocationId}`)

  if (!completable?.length) return null

  // Complete the first matching task
  const task = completable[0] as {
    id: string; title: string; reward_lore: string | null;
    trust_gain: number; giver_citizen: string | null; mystery_reveals: string | null
  }

  await supabase
    .from('player_task_progress')
    .update({ status: 'completed', completed_at: new Date().toISOString() })
    .eq(key, val)
    .eq('task_id', task.id)

  // Grant trust gain to the task giver
  if (task.giver_citizen && task.trust_gain > 0) {
    const currentTrust = await getTrustLevel(supabase, session, task.giver_citizen)
    await updateTrust(supabase, session, task.giver_citizen, currentTrust, task.trust_gain)
  }

  // Log journal entry
  await supabase.from('player_journal').insert({
    [key]: val,
    entry_type: 'task_completed',
    title: `Helped: ${task.title}`,
    content: task.reward_lore ?? 'A small kindness, given freely.',
    related_id: task.giver_citizen,
    game_date: null,
  })

  const rewardText = task.reward_lore ? `\n\n*${task.reward_lore}*` : ''
  return `You've completed a small task — **${task.title}**.${rewardText}`
}

async function getAvailableTaskOffer(
  supabase: SupabaseClient,
  session: GameSession,
  citizen: Citizen
): Promise<string | null> {
  // Find tasks given by this citizen that are valid at player's current location
  const { data: tasks } = await supabase
    .from('help_tasks')
    .select('id, title, description, location_req')
    .eq('giver_citizen', citizen.id)
    .or(`location_req.is.null,location_req.eq.${session.currentLocation}`)
    .limit(3)

  if (!tasks?.length) return null

  const key = session.playerId ? 'player_id' : 'guest_token'
  const val = session.playerId ?? session.guestToken

  // Find which tasks player has already started/completed
  const { data: progress } = await supabase
    .from('player_task_progress')
    .select('task_id, status')
    .eq(key, val)
    .in('task_id', tasks.map((t: { id: string }) => t.id))

  const progressMap = new Map((progress ?? []).map((p: { task_id: string; status: string }) => [p.task_id, p.status]))

  // Find first untouched task (not yet offered, in_progress, or completed)
  const available = tasks.find((t: { id: string }) => !progressMap.has(t.id))
  if (!available) return null

  // Mark as 'offered' — player must explicitly accept for it to appear in the Helping tab
  // Use insert-or-update pattern (no upsert) to avoid partial-index conflict issues
  const { data: existingOffer } = await supabase
    .from('player_task_progress')
    .select('task_id')
    .eq(key, val)
    .eq('task_id', (available as { id: string }).id)
    .maybeSingle()

  if (!existingOffer) {
    await supabase.from('player_task_progress').insert({
      [key]: val,
      task_id: (available as { id: string }).id,
      status: 'offered',
    })
  }

  return `*${citizen.first_name} mentions something:* "${(available as { description: string }).description}"\n\n*Type **help ${citizen.first_name}** to take on this task.*`
}

// ── ACCEPT TASK ──────────────────────────────────────────────────────────────

async function handleAcceptTask(
  supabase: SupabaseClient,
  command: ParsedCommand,
  session: GameSession
): Promise<GameResponse> {
  const targetName = command.target?.trim()
  if (!targetName) {
    return { text: 'Who do you want to help? Try *help [citizen name]*.' }
  }

  const key = session.playerId ? 'player_id' : 'guest_token'
  const val = session.playerId ?? session.guestToken

  // Find the citizen by name
  const citizen = await findCitizenByName(supabase, targetName)
  if (!citizen) {
    return { text: `You don't know anyone by that name.` }
  }

  // Get all tasks this citizen has, then check which ones this player has already started/completed
  const { data: citizenTasks } = await supabase
    .from('help_tasks')
    .select('id, title, description')
    .eq('giver_citizen', citizen.id)
    .limit(5)

  if (!citizenTasks?.length) {
    return { text: `${citizen.first_name} doesn't have any tasks available right now.` }
  }

  const citizenTaskIds = citizenTasks.map((t: { id: string }) => t.id)

  const { data: existingProgress } = await supabase
    .from('player_task_progress')
    .select('task_id, status')
    .eq(key, val)
    .in('task_id', citizenTaskIds)

  const progressMap = new Map((existingProgress ?? []).map(
    (p: { task_id: string; status: string }) => [p.task_id, p.status]
  ))

  // Accept first task that is either 'offered' or not yet touched (player learned about it via conversation)
  // Skip tasks already in_progress or completed
  const matchingTask = citizenTasks.find((t: { id: string }) => {
    const status = progressMap.get(t.id)
    return !status || status === 'offered'
  }) as { id: string; title: string; description: string } | undefined

  if (!matchingTask) {
    const allDone = citizenTasks.every((t: { id: string }) =>
      progressMap.get(t.id) === 'completed'
    )
    if (allDone) return { text: `You've already completed everything ${citizen.first_name} needed help with.` }
    return { text: `You're already helping ${citizen.first_name} with that.` }
  }

  // Insert or update to 'in_progress' — avoid upsert to sidestep partial-index limitations
  const { data: existingRow } = await supabase
    .from('player_task_progress')
    .select('task_id')
    .eq(key, val)
    .eq('task_id', matchingTask.id)
    .maybeSingle()

  if (existingRow) {
    await supabase.from('player_task_progress')
      .update({ status: 'in_progress', started_at: new Date().toISOString() })
      .eq(key, val)
      .eq('task_id', matchingTask.id)
  } else {
    await supabase.from('player_task_progress').insert({
      [key]: val,
      task_id: matchingTask.id,
      status: 'in_progress',
      started_at: new Date().toISOString(),
    })
  }

  return {
    text: `You agree to help ${citizen.first_name} with **${matchingTask.title}**.\n\n*This task now appears in your Helping tab. Type **stop helping** to remove it.*`,
    task_update: true,
  }
}

// ── STOP HELPING ─────────────────────────────────────────────────────────────

async function handleStopHelping(
  supabase: SupabaseClient,
  command: ParsedCommand,
  session: GameSession
): Promise<GameResponse> {
  const key = session.playerId ? 'player_id' : 'guest_token'
  const val = session.playerId ?? session.guestToken

  // Find all in_progress tasks for this player
  const { data: inProgressRows } = await supabase
    .from('player_task_progress')
    .select('task_id')
    .eq(key, val)
    .eq('status', 'in_progress')

  if (!inProgressRows?.length) {
    return { text: `You aren't currently helping anyone.` }
  }

  // If a citizen name is given, narrow to tasks from that citizen
  const targetName = command.target?.trim()
  let taskIdToStop: string | null = null
  let citizenName: string | null = null

  if (targetName) {
    const citizen = await findCitizenByName(supabase, targetName)
    if (!citizen) {
      return { text: `You don't know anyone by that name.` }
    }
    citizenName = citizen.first_name

    const taskIds = inProgressRows.map((r: { task_id: string }) => r.task_id)
    const { data: citizenTask } = await supabase
      .from('help_tasks')
      .select('id, title')
      .eq('giver_citizen', citizen.id)
      .in('id', taskIds)
      .limit(1)
      .single()

    if (!citizenTask) {
      return { text: `You aren't helping ${citizen.first_name} with anything right now.` }
    }
    taskIdToStop = citizenTask.id
  } else if (inProgressRows.length === 1) {
    taskIdToStop = inProgressRows[0].task_id
  } else {
    // Multiple tasks — list them and ask to specify
    const taskIds = inProgressRows.map((r: { task_id: string }) => r.task_id)
    const { data: taskList } = await supabase
      .from('help_tasks')
      .select('id, title, giver_citizen')
      .in('id', taskIds)

    if (!taskList?.length) return { text: `You aren't currently helping anyone.` }

    const lines = taskList.map((t: { title: string; giver_citizen: string }) =>
      `- **${t.title}** (for ${t.giver_citizen})`
    ).join('\n')
    return { text: `You're helping with multiple tasks. Specify who to stop helping:\n\n${lines}` }
  }

  // Delete the row — NPC will re-offer if player talks to them again
  await supabase.from('player_task_progress')
    .delete()
    .eq(key, val)
    .eq('task_id', taskIdToStop)

  const who = citizenName ? ` ${citizenName}` : ''
  return {
    text: `You set aside the task${who ? ` for ${who}` : ''}. You can always pick it up again later by talking to them.`,
    task_update: true,
  }
}

// ── RESTART GAME ─────────────────────────────────────────────────────────────

function handleRestartGame(): GameResponse {
  return {
    text: `⚠️ **Are you sure you want to restart?**\n\nThis will permanently erase all your progress — your inventory, relationships, journal entries, discoveries, and tasks. There is no undo.\n\nType **I understand** to confirm and wipe your save, or anything else to cancel.`,
    restart_pending: true,
  }
}

async function getTrustMilestoneMessage(
  supabase: SupabaseClient,
  citizenId: string,
  newLevel: number
): Promise<string | null> {
  // Fetch citizen trust_stages from citizen_dialogue (topic = 'trust_milestone_N')
  const { data } = await supabase
    .from('citizen_dialogue')
    .select('content')
    .eq('citizen_id', citizenId)
    .eq('topic', `trust_milestone_${newLevel}`)
    .single()

  if (data?.content) return data.content

  // Generic fallback milestone messages per level
  const defaults: Record<number, string[]> = {
    1: [
      "Something in their posture relaxes slightly — you're becoming a familiar face.",
      "They seem pleased to see you. There's a warmth here that wasn't there before.",
    ],
    2: [
      "You sense a small door opening — they're starting to trust you.",
      "There's an ease to the conversation now. You're no longer a stranger.",
    ],
    3: [
      "A real trust is forming between you. They speak a little more freely.",
      "You've earned something from them — not just their time, but their confidence.",
    ],
    4: [
      "They consider you a true friend. There's no guardedness left.",
      "The kind of quiet ease that takes years to build between people — you have it now.",
    ],
  }

  const options = defaults[newLevel]
  if (!options) return null

  return options[Math.floor(Math.random() * options.length)]
}

async function checkTopicForMysteryClue(
  supabase: SupabaseClient,
  session: GameSession,
  citizenId: string,
  topic: string,
  trustLevel: number
): Promise<GameResponse['mystery_update']> {
  // Find clues that are sourced from this citizen and match the topic
  const { data: clues } = await supabase
    .from('mystery_clues')
    .select('*')
    .ilike('source', `%${citizenId}%`)
    .ilike('source', `%trust%`)

  if (!clues?.length) return undefined

  const matchingClue = clues.find((c: { requires_condition: string | null }) => {
    if (!c.requires_condition) return true
    // Parse simple "citizen_trust >= N" conditions
    const match = c.requires_condition.match(/(\w+)_trust\s*>=\s*(\d+)/)
    if (match) return trustLevel >= parseInt(match[2])
    return false
  })

  if (!matchingClue) return undefined

  return checkMysteryClue(supabase, session, `citizen_${citizenId}_${topic}`, matchingClue.mystery_id)
}
