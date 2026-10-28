import { useEffect, useRef, useState } from 'react'
import type { TrackRole } from '@shared/project'
import type { LlmRetry } from '@shared/llm'
import { findProvider } from '@shared/llm-providers'
import {
  dayLabel,
  differentDay,
  duration,
  fullDate,
  relative,
  shortTime,
  stopwatch
} from '@shared/time'
import { useNow } from '../hooks/useNow'
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
  const { items, running, resumable, retry, thinkingSince, send, resume, stop, reset } = useChat()
  // Cada segundo mientras trabaja (cronómetros); si no, cada minuto ("hace N min").
  const now = useNow(running ? 1000 : 60_000)
  const { settings } = useGeneration()
  const [text, setText] = useState('')
  const listRef = useRef<HTMLDivElement>(null)

  // Mantiene la vista al final mientras llegan mensajes.
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [items])

  // Qué falta para poder hablar con el productor (clave o modelo), si falta algo.
  const llm = settings?.llm
  const preset = llm ? findProvider(llm.provider) : undefined
  const setupProblem =
    !llm || llm.simulated || !preset
      ? null
      : preset.needsKey === true && !llm.keys[preset.id]
        ? `Para usar el productor necesitas una API key de ${preset.label}.`
        : !llm.models[preset.id]
          ? `Elige un modelo de ${preset.label}.`
          : null
  const missingKey = !!setupProblem

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
          items.map((item, i) => {
            const prev = items[i - 1]
            // Separador si la conversación cruza la medianoche o viene de otro día.
            const newDay = prev ? differentDay(prev.at, item.at) : differentDay(item.at, now)
            return (
              <div key={item.id} className="space-y-2">
                {newDay && (
                  <p className="pt-1 text-center text-[10px] uppercase tracking-wide text-muted">
                    — {dayLabel(item.at, now)} —
                  </p>
                )}
                <ChatRow item={item} now={now} />
              </div>
            )
          })
        )}
        {retry ? (
          <RetryNotice retry={retry} />
        ) : (
          running &&
          items.at(-1)?.kind !== 'assistant' && (
            <p className="text-xs text-muted">
              <span className="animate-pulse">El productor está pensando…</span>
              {thinkingSince && (
                <span
                  className="ml-1 tabular-nums"
                  title="Tiempo esperando la respuesta del modelo"
                >
                  {stopwatch(now - thinkingSince)}
                </span>
              )}
            </p>
          )
        )}
      </div>

      {resumable && !running && (
        <div className="flex items-center justify-between gap-2 border-t border-line px-3 py-2 text-xs">
          <span className="text-amber-400">El productor se quedó a medias.</span>
          <button
            className="rounded bg-accent px-3 py-1 font-medium hover:brightness-110"
            onClick={() => void resume()}
          >
            ↻ Reintentar
          </button>
        </div>
      )}

      {missingKey && (
        <p className="border-t border-line px-3 py-2 text-xs text-amber-400">
          {setupProblem}{' '}
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

/** "Ollama no responde (…). Reintento 2/6 en 25 s…", con cuenta atrás. */
function RetryNotice({ retry }: { retry: LlmRetry & { until: number } }): React.JSX.Element {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const secs = Math.max(0, Math.ceil((retry.until - now) / 1000))
  return (
    <p className="text-xs text-amber-400">
      {retry.reason}{' '}
      {secs > 0
        ? `Reintento ${retry.attempt}/${retry.maxAttempts} en ${secs < 60 ? `${secs} s` : `${Math.ceil(secs / 60)} min`}…`
        : `Reintentando (${retry.attempt}/${retry.maxAttempts})…`}
    </p>
  )
}

/** Hora discreta; al pasar el cursor, la fecha completa y hace cuánto. */
function Stamp({
  at,
  now,
  className = ''
}: {
  at: number
  now: number
  className?: string
}): React.JSX.Element {
  return (
    <time
      dateTime={new Date(at).toISOString()}
      title={`${fullDate(at)} · ${relative(at, now)}`}
      className={`text-[10px] tabular-nums text-muted ${className}`}
    >
      {shortTime(at, now)}
    </time>
  )
}

/** Detalle de una herramienta al pasar el cursor: inicio, fin, duración y resultado. */
function toolTooltip(item: Extract<ChatItem, { kind: 'tool' }>, now: number): string {
  const lines = [`Empezó: ${fullDate(item.at)}`]
  if (item.endedAt) {
    lines.push(
      `Terminó: ${fullDate(item.endedAt)}`,
      `Duración: ${duration(item.endedAt - item.at)}`
    )
  } else {
    lines.push(`En marcha desde hace ${stopwatch(now - item.at)}`)
  }
  if (item.result) lines.push('', item.result)
  return lines.join('\n')
}

function ChatRow({ item, now }: { item: ChatItem; now: number }): React.JSX.Element {
  switch (item.kind) {
    case 'user':
      return (
        <div className="ml-6 rounded-lg bg-accent/25 px-3 py-2 text-white">
          <p className="whitespace-pre-wrap">{item.text}</p>
          <Stamp at={item.at} now={now} className="mt-0.5 block text-right text-white/50" />
        </div>
      )
    case 'assistant':
      return (
        <div className="text-white">
          <p className="whitespace-pre-wrap">{item.text}</p>
          <Stamp at={item.at} now={now} className="mt-0.5 block" />
        </div>
      )
    case 'notice':
      return (
        <p className={`text-xs ${item.tone === 'error' ? 'text-red-400' : 'text-muted'}`}>
          {item.text} <Stamp at={item.at} now={now} />
        </p>
      )
    case 'tool':
      return (
        <div
          className={`rounded-md border px-2 py-1.5 text-xs ${
            item.status === 'error' ? 'border-red-500/40' : 'border-line'
          } bg-bg`}
          title={toolTooltip(item, now)}
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
            <span className="min-w-0 flex-1 text-white">
              {describeTool(item.name, item.input, item.status)}
            </span>
            <span className="shrink-0 self-start tabular-nums text-muted">
              {item.endedAt ? duration(item.endedAt - item.at) : stopwatch(now - item.at)}
            </span>
          </div>
          {item.status === 'running' && item.progress && (
            <p className="mt-1 text-muted">{item.progress}</p>
          )}
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
    case 'compose_song': {
      const sections = Array.isArray(input.sections)
        ? (input.sections as { name?: unknown }[])
            .map((s) => (typeof s?.name === 'string' ? s.name : ''))
            .filter(Boolean)
        : []
      return `${running ? 'Componiendo' : 'Compuesta'} la canción: ${sections.join(' → ')}${running ? ' (se graba parte a parte; cada una tarda unos minutos)' : ''}`
    }
    case 'redo_sections':
      return running ? 'Grabando de nuevo las partes que fallaban' : 'Partes grabadas de nuevo'
    case 'set_drums':
      return input.pattern === 'off'
        ? 'Quitando la batería programada'
        : `${running ? 'Programando' : 'Programada'} la batería (${String(input.pattern ?? '')})`
    case 'review_song':
      return running ? 'Escuchando la canción' : 'Canción escuchada'
    case 'genre_guide':
      return `Consultando cómo suena ${typeof input.genre === 'string' ? `“${input.genre}”` : 'el género'}`
    case 'fill_section':
      return `${running ? 'Rellenando' : 'Rellenado'} “${input.section}” con ${role}: “${input.prompt}”`
    case 'set_sections':
      return 'Planificando la estructura'
    case 'copy_section':
      return 'Copiando una sección'
    case 'create_variation':
      return `${running ? 'Creando' : 'Creada'} otra versión de una región`
    case 'extend_region':
      return `${running ? 'Continuando' : 'Continuada'} una región ${input.bars} compases`
    case 'separate_stems':
      return `${running ? 'Separando' : 'Separada'} la canción en instrumentos`
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
