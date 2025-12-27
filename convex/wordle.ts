import {
  action,
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { getCurrentUserOrThrow } from "./users";

// Internal query to get puzzle from database
export const getPuzzleFromDb = internalQuery({
  args: {
    date: v.string(),
  },
  handler: async (ctx, args) => {
    const puzzle = await ctx.db
      .query("wordles")
      .withIndex("by_date", (q) => q.eq("date", args.date))
      .first();
    return puzzle;
  },
});

// Internal mutation to store puzzle in database
export const storePuzzle = internalMutation({
  args: {
    date: v.string(),
    solution: v.string(),
    puzzleId: v.number(),
    printDate: v.string(),
    daysSinceLaunch: v.number(),
  },
  handler: async (ctx, args) => {
    // Check if puzzle already exists
    const existing = await ctx.db
      .query("wordles")
      .withIndex("by_date", (q) => q.eq("date", args.date))
      .first();

    if (existing) {
      return existing._id;
    }

    // Store new puzzle
    const id = await ctx.db.insert("wordles", {
      date: args.date,
      solution: args.solution,
      puzzleId: args.puzzleId,
      printDate: args.printDate,
      daysSinceLaunch: args.daysSinceLaunch,
    });
    return id;
  },
});

// Fetch Wordle puzzle from NYTimes API (public action for external use if needed)
export const getPuzzle = action({
  args: {
    date: v.string(), // Format: YYYY-MM-DD
  },
  handler: async (ctx, args) => {
    const url = `https://www.nytimes.com/svc/wordle/v2/${args.date}.json`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to fetch puzzle: ${response.statusText}`);
    }

    const data = await response.json();
    return {
      solution: data.solution,
      id: data.id,
      printDate: data.print_date,
      daysSinceLaunch: data.days_since_launch,
    };
  },
});

// Internal mutation to save game state (only called from actions)
export const saveGameStateInternal = internalMutation({
  args: {
    date: v.string(),
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
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);
    const existing = await ctx.db
      .query("wordleGameStates")
      .withIndex("by_user_and_date", (q) =>
        q.eq("userId", user._id).eq("date", args.date)
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        guesses: args.guesses,
        isGameOver: args.isGameOver,
      });
      return existing._id;
    } else {
      const id = await ctx.db.insert("wordleGameStates", {
        userId: user._id,
        date: args.date,
        guesses: args.guesses,
        isGameOver: args.isGameOver,
      });
      return id;
    }
  },
});

// Check a guess against the solution and automatically save game state
// This action validates the guess and saves the state server-side
export const checkGuess = action({
  args: {
    date: v.string(),
    guess: v.string(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{
    feedback: Array<"correct" | "present" | "absent">;
    isCorrect: boolean;
    isGameOver: boolean;
  }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    // First, try to get puzzle from database
    let puzzle = await ctx.runQuery(internal.wordle.getPuzzleFromDb, {
      date: args.date,
    });

    // If not in database, fetch from NYTimes and store it
    if (!puzzle) {
      const url = `https://www.nytimes.com/svc/wordle/v2/${args.date}.json`;
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Failed to fetch puzzle: ${response.statusText}`);
      }

      const puzzleData: {
        solution: string;
        id: number;
        print_date: string;
        days_since_launch: number;
      } = await response.json();

      // Store in database
      await ctx.runMutation(internal.wordle.storePuzzle, {
        date: args.date,
        solution: puzzleData.solution,
        puzzleId: puzzleData.id,
        printDate: puzzleData.print_date,
        daysSinceLaunch: puzzleData.days_since_launch,
      });

      // Use the puzzle data we already have instead of querying again
      puzzle = {
        solution: puzzleData.solution,
      } as NonNullable<typeof puzzle>;
    }

    const solution: string = puzzle!.solution.toLowerCase();
    const guess: string = args.guess.toLowerCase();

    if (guess.length !== 5) {
      throw new Error("Guess must be 5 letters");
    }

    // Get current game state to validate and update
    const currentState = await ctx.runQuery(
      internal.wordle.getGameStateInternal,
      {
        userId: identity.subject,
        date: args.date,
      }
    );

    // Validate that we haven't already submitted 6 guesses
    if (currentState && currentState.guesses.length >= 6) {
      throw new Error("Maximum guesses reached");
    }

    // Validate that the game isn't already over
    if (currentState && currentState.isGameOver) {
      throw new Error("Game is already over");
    }

    // Calculate feedback for each letter
    const feedback: Array<"correct" | "present" | "absent"> = [];
    const solutionLetters: string[] = solution.split("");
    const guessLetters: string[] = guess.split("");

    // First pass: mark correct positions
    for (let i = 0; i < 5; i++) {
      if (guessLetters[i] === solutionLetters[i]) {
        feedback[i] = "correct";
      }
    }

    // Second pass: mark present and absent
    for (let i = 0; i < 5; i++) {
      if (feedback[i] === "correct") continue;

      const letter: string = guessLetters[i];
      const solutionCount: number = (
        solution.match(new RegExp(letter, "g")) || []
      ).length;
      const correctCount: number = solutionLetters
        .map((sol: string, idx: number) =>
          sol === letter && guessLetters[idx] === letter ? 1 : 0
        )
        .reduce((a: number, b: number) => a + b, 0);
      const alreadyMarkedPresent: number = guessLetters
        .slice(0, i)
        .filter(
          (g: string, idx: number) =>
            g === letter && feedback[idx] === "present"
        ).length;

      if (
        solution.includes(letter) &&
        correctCount + alreadyMarkedPresent < solutionCount
      ) {
        feedback[i] = "present";
      } else {
        feedback[i] = "absent";
      }
    }

    const isCorrect: boolean = guess === solution;
    const existingGuesses = currentState?.guesses || [];
    const newGuess = {
      word: guess.toUpperCase(),
      feedback,
    };
    const updatedGuesses = [...existingGuesses, newGuess];
    const isGameOver = isCorrect || updatedGuesses.length >= 6;

    // Save the validated game state
    await ctx.runMutation(internal.wordle.saveGameStateInternal, {
      // userId: identity.subject,
      date: args.date,
      guesses: updatedGuesses,
      isGameOver,
    });

    return {
      feedback,
      isCorrect,
      isGameOver,
    };
  },
});

// Internal query to get game state (used by actions)
export const getGameStateInternal = internalQuery({
  args: {
    userId: v.string(),
    date: v.string(),
  },
  handler: async (ctx, args) => {
    const gameState = await ctx.db
      .query("wordleGameStates")
      .withIndex("by_user_and_date", (q) =>
        q.eq("userId", args.userId).eq("date", args.date)
      )
      .first();

    return gameState;
  },
});

// Get game state for the current user and date, including puzzle info for sharing
export const getGameState = query({
  args: {
    date: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrThrow(ctx);

    const gameState = await ctx.db
      .query("wordleGameStates")
      .withIndex("by_user_and_date", (q) =>
        q.eq("userId", user._id).eq("date", args.date)
      )
      .first();

    // Get puzzle info for sharing
    const puzzle = await ctx.db
      .query("wordles")
      .withIndex("by_date", (q) => q.eq("date", args.date))
      .first();

    if (!gameState) {
      return puzzle
        ? {
            guesses: [],
            isGameOver: false,
            daysSinceLaunch: puzzle.daysSinceLaunch,
          }
        : null;
    }

    return {
      ...gameState,
      daysSinceLaunch: puzzle?.daysSinceLaunch,
    };
  },
});
