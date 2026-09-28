import { useEffect, useRef, useState } from 'react'
import type { TrackRole } from '@shared/project'
import { ROLE_LABELS } from '../labels'
import { useChat, type ChatItem } from '../store/chat'
import { useGeneration } from '../store/generation'

const IDEAS = [
  'Hazme un beat lo-fi a 80 BPM con piano melancólico',
  'Añade un bajo más grave y bájale un poco el volumen a la batería',
  'Alarga todo hasta 16 compases',
  'Algo de synthwave ochentero con batería electrónica'
]

export function ChatPanel({ onOpenSettings }: { onOpenSettings(): void }): React.JSX.Element {
  const { items, running, send, stop, reset } = useChat()
  const { settings } = useGeneration()
  const [text, setText] = useState('')
  const listRef = useRef<HTMLDivElement>(null)

  // Mantiene la vista al final mientras llegan mensajes.
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [items])

  const llm = settings?.llm
  const missingKey =
    !!llm &&
    ((llm.provider === 'anthropic' && !llm.hasAnthropicKey) ||
      (llm.provider === 'openai' && !llm.hasOpenaiKey))

  const submit = (value = text): void => {
    if (!value.trim() || running) return
    setText('')
    void send(value)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={listRef} className="min-h-0 flex-1 space-y-2 overflow-auto p-3 text-sm">
        {items.length === 0 ? (
          <div className="space-y-3 text-muted">
            <p>
              Cuéntale al productor qué canción quieres. Él elige el tempo, genera cada capa, la
              coloca en el timeline y ajusta la mezcla.
            </p>
            <div className="flex flex-col gap-1.5">
              {IDEAS.map((idea) => (
                <button
                  key={idea}
                  disabled={missingKey}
                  onClick={() => submit(idea)}
                  className="rounded-md border border-line px-2 py-1.5 text-left text-xs hover:border-accent hover:text-white disabled:opacity-50"
                >
                  “{idea}”
                </button>
              ))}
            </div>
          </div>
        ) : (
          items.map((item) => <ChatRow key={item.id} item={item} />)
        )}
        {running && items.at(-1)?.kind !== 'assistant' && (
          <p className="animate-pulse text-xs text-muted">El productor está pensando…</p>
        )}
      </div>

      {missingKey && (
        <p className="border-t border-line px-3 py-2 text-xs text-amber-400">
          Para usar el productor necesitas una API key del proveedor de IA.{' '}
          <button className="underline" onClick={onOpenSettings}>
            Abrir ajustes
          </button>
        </p>
      )}

      <div className="border-t border-line p-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
          rows={2}
          placeholder="Describe lo que quieres… (Enter para enviar)"
          aria-label="Mensaje para el productor"
          className="w-full resize-none rounded border border-line bg-bg px-2 py-1.5 text-sm text-white"
        />
        <div className="mt-1 flex items-center justify-between">
          <button
            className="text-xs text-muted hover:text-white disabled:opacity-40"
            onClick={reset}
            disabled={items.length === 0 || running}
          >
            Nueva conversación
          </button>
          {running ? (
            <button
              className="rounded bg-red-500/80 px-3 py-1 text-xs font-medium hover:bg-red-500"
              onClick={stop}
            >
              ■ Parar
            </button>
          ) : (
            <button
              className="rounded bg-accent px-3 py-1 text-xs font-medium disabled:opacity-40"
              disabled={!text.trim() || missingKey}
              onClick={() => submit()}
            >
              Enviar
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function ChatRow({ item }: { item: ChatItem }): React.JSX.Element {
  switch (item.kind) {
    case 'user':
      return (
        <div className="ml-6 whitespace-pre-wrap rounded-lg bg-accent/25 px-3 py-2 text-white">
          {item.text}
        </div>
      )
    case 'assistant':
      return <div className="whitespace-pre-wrap text-white">{item.text}</div>
    case 'notice':
      return (
        <p className={`text-xs ${item.tone === 'error' ? 'text-red-400' : 'text-muted'}`}>
          {item.text}
        </p>
      )
    case 'tool':
      return (
        <div
          className={`rounded-md border px-2 py-1.5 text-xs ${
            item.status === 'error' ? 'border-red-500/40' : 'border-line'
          } bg-bg`}
          title={item.result}
        >
          <div className="flex items-center gap-2">
            <span className="shrink-0">
              {item.status === 'running' ? (
                <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent" />
              ) : item.status === 'ok' ? (
                <span className="text-emerald-400">✓</span>
              ) : (
                <span className="text-red-400">✕</span>
              )}
            </span>
            <span className="text-white">{describeTool(item.name, item.input, item.status)}</span>
          </div>
          {item.status === 'error' && item.result && (
            <p className="mt-1 text-red-400">{item.result}</p>
          )}
        </div>
      )
  }
}

/** Traduce una llamada a herramienta a una frase para el usuario. */
export function describeTool(
  name: string,
  input: Record<string, unknown>,
  status: 'running' | 'ok' | 'error'
): string {
  const running = status === 'running'
  const role = ROLE_LABELS[input.role as TrackRole]?.toLowerCase() ?? 'audio'
  switch (name) {
    case 'get_project_state':
      return 'Revisando el proyecto'
    case 'set_tempo_key':
      return [
        input.bpm !== undefined && `Tempo ${input.bpm} BPM`,
        input.key !== undefined && `tonalidad ${input.key}`
      ]
        .filter(Boolean)
        .join(' · ')
    case 'generate_clip':
      return `${running ? 'Generando' : 'Generado'} ${role}: “${input.prompt}” · ${input.bars} compases desde el compás ${input.start_bar}`
    case 'repeat_region':
      return `Repitiendo una región ${input.times} ${input.times === 1 ? 'vez' : 'veces'}`
    case 'move_region':
      return `Moviendo una región al compás ${input.start_bar}`
    case 'delete_region':
      return 'Borrando una región'
    case 'set_track': {
      const parts = [
        input.name !== undefined && `nombre “${input.name}”`,
        input.gain_db !== undefined && `volumen ${input.gain_db} dB`,
        input.pan !== undefined && `pan ${input.pan}`,
        input.mute !== undefined && (input.mute ? 'silenciada' : 'sin silenciar'),
        input.solo !== undefined && (input.solo ? 'en solo' : 'sin solo')
      ].filter(Boolean)
      return `Ajustando pista: ${parts.join(', ')}`
    }
    case 'delete_track':
      return 'Borrando una pista'
    case 'play':
      return `Reproduciendo desde el compás ${input.from_bar ?? 1}`
    default:
      return name
  }
}
