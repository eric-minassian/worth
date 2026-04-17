import { Schema } from "effect"

/**
 * Channel name used for the single generic RPC bridge between renderer and main.
 * Over HTTP in the future, this becomes the `/rpc` endpoint.
 */
export const RPC_CHANNEL = "worth:rpc"

/** A typed command definition: a literal kind plus its input and output schemas. */
export interface CommandDef<
  K extends string,
  In extends Schema.Top,
  Out extends Schema.Top,
> {
  readonly kind: K
  readonly input: In
  readonly output: Out
}

const defineCommand = <K extends string, In extends Schema.Top, Out extends Schema.Top>(
  kind: K,
  input: In,
  output: Out,
): CommandDef<K, In, Out> => ({ kind, input, output })

// -- Commands ---------------------------------------------------------------
//
// Each command has an input schema and an output schema. Both sides decode
// against these; nothing crosses the boundary untyped.

export const PingCommand = defineCommand(
  "ping",
  Schema.Struct({ message: Schema.String }),
  Schema.Struct({ message: Schema.String, at: Schema.String }),
)

export const Commands = {
  ping: PingCommand,
} as const

export type Commands = typeof Commands
export type CommandKind = keyof Commands
export type InputOf<K extends CommandKind> = Schema.Schema.Type<Commands[K]["input"]>
export type OutputOf<K extends CommandKind> = Schema.Schema.Type<Commands[K]["output"]>

// -- Wire envelopes ---------------------------------------------------------

export const RpcRequestEnvelope = Schema.Struct({
  kind: Schema.String,
  input: Schema.Unknown,
})
export type RpcRequestEnvelope = Schema.Schema.Type<typeof RpcRequestEnvelope>

export const RpcError = Schema.Struct({
  _tag: Schema.String,
  message: Schema.String,
})
export type RpcError = Schema.Schema.Type<typeof RpcError>

export const RpcResponseEnvelope = Schema.Union([
  Schema.Struct({ ok: Schema.Literal(true), value: Schema.Unknown }),
  Schema.Struct({ ok: Schema.Literal(false), error: RpcError }),
])
export type RpcResponseEnvelope = Schema.Schema.Type<typeof RpcResponseEnvelope>

/**
 * Shape exposed on `window.worth` by the Electron preload script. Identical
 * over-the-wire shape will be served by the future self-hosted HTTP server.
 */
export interface WorthApi {
  readonly rpc: (message: RpcRequestEnvelope) => Promise<RpcResponseEnvelope>
}
