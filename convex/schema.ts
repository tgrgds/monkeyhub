import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    name: v.string(),
    // this the Clerk ID, stored in the subject JWT field
    externalId: v.string(),
  }).index("byExternalId", ["externalId"]),
  wordles: defineTable({
    date: v.string(), // Format: YYYY-MM-DD
    solution: v.string(),
    puzzleId: v.number(),
    printDate: v.string(),
    daysSinceLaunch: v.number(),
  }).index("by_date", ["date"]),
  gameStates: defineTable({
    userId: v.string(),
    date: v.string(), // Format: YYYY-MM-DD
    guesses: v.array(
      v.object({
        word: v.string(),
        feedback: v.array(
          v.union(
            v.literal("correct"),
            v.literal("present"),
            v.literal("absent")
          )
        ),
      })
    ),
    isGameOver: v.boolean(),
  })
    .index("by_user_and_date", ["userId", "date"])
    .index("by_user", ["userId"]),
});
