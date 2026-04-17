import { asc } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { Db, schema } from "@worth/db"
import type { Category, CategoryId } from "@worth/domain"
import { newCategoryId } from "@worth/sync"
import { EventLog } from "../EventLog"

export interface CreateCategoryInput {
  readonly name: string
  readonly parentId: CategoryId | null
  readonly color: string | null
}

export class CategoryService extends Context.Service<
  CategoryService,
  {
    readonly create: (input: CreateCategoryInput) => Effect.Effect<Category>
    readonly list: Effect.Effect<readonly Category[]>
  }
>()("@worth/core/CategoryService") {}

const rowToCategory = (row: typeof schema.categories.$inferSelect): Category => ({
  id: row.id as CategoryId,
  name: row.name,
  parentId: (row.parentId ?? null) as CategoryId | null,
  color: row.color,
  createdAt: row.createdAt,
})

export const CategoryServiceLive = Layer.effect(CategoryService)(
  Effect.gen(function* () {
    const db = yield* Db
    const log = yield* EventLog

    const create = (input: CreateCategoryInput): Effect.Effect<Category> =>
      Effect.gen(function* () {
        const id = newCategoryId()
        const at = Date.now()
        yield* log.append({
          _tag: "CategoryCreated",
          id,
          name: input.name,
          parentId: input.parentId,
          color: input.color,
          at,
        })
        return {
          id,
          name: input.name,
          parentId: input.parentId,
          color: input.color,
          createdAt: at,
        }
      })

    const list = Effect.sync(() => {
      const rows = db.drizzle
        .select()
        .from(schema.categories)
        .orderBy(asc(schema.categories.name))
        .all()
      return rows.map(rowToCategory)
    })

    return { create, list }
  }),
)
