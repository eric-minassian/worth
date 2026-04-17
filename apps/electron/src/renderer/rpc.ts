import { Schema } from "effect"
import { Commands, type CommandKind, type InputOf, type OutputOf } from "@worth/ipc"

/** Domain error surfaced to the UI. Thrown by `callCommand` on non-ok responses. */
export class RpcError extends Error {
  readonly tag: string
  constructor(tag: string, message: string) {
    super(message)
    this.tag = tag
    this.name = "RpcError"
  }
}

const formatIssue = (issue: unknown): string =>
  issue instanceof Error ? issue.message : String(issue)

/**
 * Typed RPC caller. Sends `{ kind, input }` to the main process, decodes the
 * response, and either returns the strongly-typed output or throws `RpcError`.
 */
export const callCommand = async <K extends CommandKind>(
  kind: K,
  input: InputOf<K>,
): Promise<OutputOf<K>> => {
  const command = Commands[kind]
  const encodedInput = Schema.encodeUnknownResult(command.input)(input)
  if (encodedInput._tag === "Failure") {
    throw new RpcError("InvalidInput", formatIssue(encodedInput.failure))
  }

  const response = await window.worth.rpc({ kind, input: encodedInput.success })
  if (!response.ok) {
    throw new RpcError(response.error._tag, response.error.message)
  }

  const decoded = Schema.decodeUnknownResult(command.output)(response.value)
  if (decoded._tag === "Failure") {
    throw new RpcError("OutputDecodeError", formatIssue(decoded.failure))
  }
  return decoded.success as OutputOf<K>
}
