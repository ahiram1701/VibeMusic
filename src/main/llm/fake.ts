import type { ContentBlock, LlmRequest, LlmResponse } from '@shared/llm'
import { sleep } from '../audio-providers/types'
import type { LlmAdapter } from './types'

// LLM de mentira, determinista, para las pruebas e2e (se activa con VIBE_FAKE_LLM=1).
// Simula a un productor: mira el proyecto, pone el tempo, genera dos capas y resume.

export function createFakeAdapter(): LlmAdapter {
  return {
    async chat(req: LlmRequest, onText, signal): Promise<LlmResponse> {
      const lastUserText = req.messages.findLastIndex(
        (m) => m.role === 'user' && m.content.some((b) => b.type === 'text')
      )
      const step = req.messages.slice(lastUserText).filter((m) => m.role === 'assistant').length
      const say = async (text: string): Promise<ContentBlock> => {
        for (const word of text.split(/(?<= )/)) {
          await sleep(5, signal)
          onText(word)
        }
        return { type: 'text', text }
      }
      const use = (id: string, name: string, input: Record<string, unknown>): ContentBlock => ({
        type: 'tool_use',
        id: `${id}_${lastUserText}`,
        name,
        input
      })

      if (step === 0) {
        return {
          stopReason: 'tool_use',
          content: [
            await say('Vale, miro cómo está el proyecto. '),
            use('s', 'get_project_state', {})
          ]
        }
      }
      if (step === 1) {
        return {
          stopReason: 'tool_use',
          content: [
            await say('Pongo 90 BPM y genero batería y bajo. '),
            use('t', 'set_tempo_key', { bpm: 90, key: 'A minor' }),
            use('d', 'generate_clip', {
              prompt: 'boom bap drums',
              role: 'drums',
              bars: 2,
              start_bar: 1
            }),
            use('b', 'generate_clip', {
              prompt: 'warm bassline',
              role: 'bass',
              bars: 2,
              start_bar: 1
            })
          ]
        }
      }
      return {
        stopReason: 'end_turn',
        content: [await say('Listo: batería y bajo de 2 compases a 90 BPM en La menor.')]
      }
    }
  }
}
