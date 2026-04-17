import { Cause, Exit, Schema } from "effect"
import {
  Commands,
  RpcRequestEnvelope,
  type CommandKind,
  type InputOf,
  type RpcResponseEnvelope,
} from "@worth/ipc"
import { handlers } from "./handlers"
import type { AppRuntime } from "./runtime"

const isCommandKind = (kind: string): kind is CommandKind =>
  Object.prototype.hasOwnProperty.call(Commands, kind)

const decodeEnvelope = Schema.decodeUnknownResult(RpcRequestEnvelope)

const formatIssue = (issue: unknown): string =>
  issue instanceof Error ? issue.message : String(issue)

const causeToError = (cause: Cause.Cause<unknown>): { _tag: string; message: string } => {
  const errorOption = Cause.findErrorOption(cause)
  if (errorOption._tag === "Some") {
    const failure = errorOption.value
    if (failure !== null && typeof failure === "object") {
      const tag = "_tag" in failure && typeof failure._tag === "string" ? failure._tag : "Unknown"
      const message =
        "message" in failure && typeof failure.message === "string"
          ? failure.message
          : JSON.stringify(failure)
      return { _tag: tag, message }
    }
    return { _tag: "Unknown", message: String(failure) }
  }
  return { _tag: "Defect", message: Cause.pretty(cause) }
}

export const makeRpcHandler =
  (runtime: AppRuntime) =>
  async (raw: unknown): Promise<RpcResponseEnvelope> => {
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

    return dispatch(runtime, kind, input)
  }

const dispatch = async <K extends CommandKind>(
  runtime: AppRuntime,
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

  const handler = handlers[kind]
  const program = handler(decodedInput.success as InputOf<K>)
  const exit = await runtime.runPromiseExit(program)

  if (Exit.isFailure(exit)) {
    return { ok: false, error: causeToError(exit.cause) }
  }

  const encoded = Schema.encodeUnknownResult(command.output)(exit.value)
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
}
