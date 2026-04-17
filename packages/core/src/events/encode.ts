import { Schema } from "effect"
import { DomainEvent } from "@worth/domain"

const encode = Schema.encodeUnknownSync(DomainEvent)
const decode = Schema.decodeUnknownSync(DomainEvent)

/** Serialize a domain event to the JSON string we persist in `events.payload`. */
export const encodeEvent = (event: DomainEvent): string => JSON.stringify(encode(event))

/** Deserialize a stored event from its `events.payload` string back to a domain event. */
export const decodeEvent = (payload: string): DomainEvent => decode(JSON.parse(payload))
