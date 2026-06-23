import Anthropic from '@anthropic-ai/sdk'

// Singleton — reused across requests in the same server instance
let _client: Anthropic | null = null

export function getAnthropicClient(): Anthropic {
  if (!_client) {
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
  }
  return _client
}

export const MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-haiku-4-5-20251001'
