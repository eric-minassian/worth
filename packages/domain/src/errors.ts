import { Data } from "effect"

export class NotFound extends Data.TaggedError("NotFound")<{
  readonly entity: string
  readonly id: string
}> {}

export class AlreadyExists extends Data.TaggedError("AlreadyExists")<{
  readonly entity: string
  readonly id: string
}> {}

export class ValidationError extends Data.TaggedError("ValidationError")<{
  readonly message: string
}> {}

export class ImportError extends Data.TaggedError("ImportError")<{
  readonly message: string
}> {}
