import { Effect, Schema } from "effect"
import {
  Commands,
  RpcRequestEnvelope,
  type CommandKind,
  type InputOf,
  type OutputOf,
  type RpcResponseEnvelope,
} from "@worth/ipc"

// -- Handlers ---------------------------------------------------------------

type HandlerMap = {
  [K in CommandKind]: (input: InputOf<K>) => Effect.Effect<OutputOf<K>>
}

const handlers: HandlerMap = {
  ping: (input) =>
    Effect.sync(() => ({
      message: `pong: ${input.message}`,
      at: new Date().toISOString(),
    })),
}

// -- Dispatcher -------------------------------------------------------------

const isCommandKind = (kind: string): kind is CommandKind =>
  Object.prototype.hasOwnProperty.call(Commands, kind)

const decodeEnvelope = Schema.decodeUnknownResult(RpcRequestEnvelope)

const formatIssue = (issue: unknown): string =>
  issue instanceof Error ? issue.message : String(issue)

/**
 * Decodes an incoming request, routes it to its handler, and returns a
 * fully-serialized response envelope. No exceptions cross this boundary —
 * every failure lands in the error channel.
 */
export const handleRpc = async (raw: unknown): Promise<RpcResponseEnvelope> => {
  const decoded = decodeEnvelope(raw)
  if (decoded._tag === "Failure") {
    return {
      ok: false,
      error: {
        _tag: "DecodeError",
        message: `Invalid RPC envelope: ${formatIssue(decoded.failure)}`,
      },
    }
  }
  const { kind, input } = decoded.success

  if (!isCommandKind(kind)) {
    return { ok: false, error: { _tag: "UnknownCommand", message: `Unknown command: ${kind}` } }
  }

  return dispatch(kind, input)
}

const dispatch = async <K extends CommandKind>(
  kind: K,
  rawInput: unknown,
): Promise<RpcResponseEnvelope> => {
  const command = Commands[kind]
  const decodedInput = Schema.decodeUnknownResult(command.input)(rawInput)
  if (decodedInput._tag === "Failure") {
    return {
      ok: false,
      error: {
        _tag: "InvalidInput",
        message: `Invalid input for "${kind}": ${formatIssue(decodedInput.failure)}`,
      },
    }
  }

  try {
    const handler = handlers[kind] as (input: InputOf<K>) => Effect.Effect<OutputOf<K>>
    const output = await Effect.runPromise(handler(decodedInput.success as InputOf<K>))
    const encoded = Schema.encodeUnknownResult(command.output)(output)
    if (encoded._tag === "Failure") {
      return {
        ok: false,
        error: {
          _tag: "OutputEncodeError",
          message: `Failed to encode "${kind}" output: ${formatIssue(encoded.failure)}`,
        },
      }
    }
    return { ok: true, value: encoded.success }
  } catch (e) {
    return {
      ok: false,
      error: { _tag: "UnknownError", message: e instanceof Error ? e.message : String(e) },
    }
  }
}
