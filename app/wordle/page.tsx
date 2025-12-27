"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

type Feedback = "correct" | "present" | "absent" | null;

interface Guess {
  word: string;
  feedback: Feedback[];
}

export default function WordlePage() {
  const [guesses, setGuesses] = useState<Guess[]>([]);
  const [currentGuess, setCurrentGuess] = useState("");
  const [isGameOver, setIsGameOver] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [todayDate, setTodayDate] = useState("");
  const [shareSuccess, setShareSuccess] = useState(false);
  const isGameOverRef = useRef(false);

  const checkGuess = useAction(api.wordle.checkGuess);
  const savedGameState = useQuery(
    api.wordle.getGameState,
    todayDate ? { date: todayDate } : "skip"
  );

  // Keep ref in sync with state
  useEffect(() => {
    isGameOverRef.current = isGameOver;
  }, [isGameOver]);

  // Get today's date in YYYY-MM-DD format
  useEffect(() => {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, "0");
    const day = String(today.getDate()).padStart(2, "0");
    setTodayDate(`${year}-${month}-${day}`);
  }, []);

  // Load game state from Convex when it's available
  useEffect(() => {
    if (savedGameState !== undefined && savedGameState !== null) {
      setGuesses(savedGameState.guesses);
      // Don't restore currentGuess - only restore completed guesses
      setIsGameOver(savedGameState.isGameOver);
    }
  }, [savedGameState]);

  const handleSubmitGuess = useCallback(async () => {
    if (currentGuess.length !== 5 || !todayDate) return;
    if (isGameOverRef.current) return;

    setIsLoading(true);
    setError(null);

    try {
      const result = await checkGuess({
        date: todayDate,
        guess: currentGuess,
      });

      // checkGuess now automatically saves the validated game state
      // We just need to update local state to reflect the saved state
      const newGuess: Guess = {
        word: currentGuess.toUpperCase(),
        feedback: result.feedback,
      };

      setGuesses((prevGuesses) => [...prevGuesses, newGuess]);
      setCurrentGuess("");
      setIsGameOver(result.isGameOver);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to check guess");
    } finally {
      setIsLoading(false);
    }
  }, [currentGuess, todayDate, checkGuess]);

  const handleKeyPress = useCallback(
    (key: string) => {
      if (isGameOver || isLoading) return;

      if (key === "Enter") {
        if (currentGuess.length === 5) {
          handleSubmitGuess();
        }
      } else if (key === "Backspace") {
        setCurrentGuess((prev) => prev.slice(0, -1));
      } else if (
        key.length === 1 &&
        key.match(/[a-zA-Z]/) &&
        currentGuess.length < 5
      ) {
        setCurrentGuess((prev) => prev + key.toUpperCase());
      }
    },
    [currentGuess, isGameOver, isLoading, handleSubmitGuess]
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore modifier keys
      if (e.metaKey || e.ctrlKey || e.altKey) {
        return;
      }

      // Only process single-character letter keys, Enter, or Backspace
      if (
        e.key === "Enter" ||
        e.key === "Backspace" ||
        (e.key.length === 1 && e.key.match(/[a-zA-Z]/))
      ) {
        e.preventDefault();
        handleKeyPress(e.key);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyPress]);

  const getCellColor = (feedback: Feedback) => {
    switch (feedback) {
      case "correct":
        return "bg-green-500 text-white";
      case "present":
        return "bg-yellow-500 text-white";
      case "absent":
        return "bg-gray-500 text-white";
      default:
        return "bg-gray-200 dark:bg-gray-800 border-2 border-gray-300 dark:border-gray-600";
    }
  };

  // Check if a letter has been confirmed as absent (not in the answer)
  const isLetterAbsent = useCallback(
    (letter: string): boolean => {
      for (const guess of guesses) {
        for (let i = 0; i < guess.word.length; i++) {
          if (guess.word[i] === letter.toUpperCase()) {
            // If the letter appears in a guess and is marked as absent,
            // and it's not also marked as present or correct elsewhere, it's absent
            if (guess.feedback[i] === "absent") {
              // Check if this letter is present or correct in any other guess
              let foundPresentOrCorrect = false;
              for (const otherGuess of guesses) {
                for (let j = 0; j < otherGuess.word.length; j++) {
                  if (
                    otherGuess.word[j] === letter.toUpperCase() &&
                    (otherGuess.feedback[j] === "present" ||
                      otherGuess.feedback[j] === "correct")
                  ) {
                    foundPresentOrCorrect = true;
                    break;
                  }
                }
                if (foundPresentOrCorrect) break;
              }
              // Only mark as absent if we never found it as present or correct
              if (!foundPresentOrCorrect) {
                return true;
              }
            }
          }
        }
      }
      return false;
    },
    [guesses]
  );

  const getKeyColor = (letter: string) => {
    if (isLetterAbsent(letter)) {
      return "bg-gray-500 text-white dark:bg-gray-600 opacity-50";
    }
    return "bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100";
  };

  // Generate share text in Wordle format
  const generateShareText = useCallback(() => {
    if (!savedGameState?.daysSinceLaunch || guesses.length === 0) return "";

    const puzzleNumber = savedGameState.daysSinceLaunch;
    const guessCount = guesses.length;
    const won = guesses.some((g) => g.feedback.every((f) => f === "correct"));

    let shareText = `Wordle ${puzzleNumber.toLocaleString()} ${
      won ? guessCount : "X"
    }/6\n\n`;

    guesses.forEach((guess) => {
      const emojiRow = guess.feedback
        .map((f) => {
          switch (f) {
            case "correct":
              return "🟩";
            case "present":
              return "🟨";
            case "absent":
              return "⬛";
            default:
              return "⬛";
          }
        })
        .join("");
      shareText += emojiRow + "\n";
    });

    return shareText.trim();
  }, [savedGameState, guesses]);

  const handleShare = useCallback(async () => {
    const shareText = generateShareText();
    if (!shareText) return;

    try {
      await navigator.clipboard.writeText(shareText);
      setShareSuccess(true);
      setError(null);
      // Hide success message after 2 seconds
      setTimeout(() => {
        setShareSuccess(false);
      }, 2000);
    } catch (err) {
      console.error("Failed to copy to clipboard:", err);
      setError("Failed to copy to clipboard");
    }
  }, [generateShareText]);

  const keyboardRows = [
    ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
    ["A", "S", "D", "F", "G", "H", "J", "K", "L"],
    ["Z", "X", "C", "V", "B", "N", "M"],
  ];

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 relative">
      <div className="w-full max-w-md pb-8">
        <h1 className="text-4xl font-bold text-center mb-8">WORDLE</h1>

        {error && (
          <div className="bg-red-100 dark:bg-red-900 border border-red-400 text-red-700 dark:text-red-200 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        <div className="flex flex-col gap-2 mb-8">
          {Array.from({ length: 6 }).map((_, rowIndex) => (
            <div key={rowIndex} className="grid grid-cols-5 gap-2">
              {Array.from({ length: 5 }).map((_, colIndex) => {
                const guess = guesses[rowIndex];
                const isCurrentRow = rowIndex === guesses.length;
                const letter =
                  isCurrentRow && colIndex < currentGuess.length
                    ? currentGuess[colIndex]
                    : guess
                    ? guess.word[colIndex]
                    : "";

                return (
                  <div
                    key={colIndex}
                    className={`aspect-square flex items-center justify-center text-2xl font-bold rounded transition-colors ${
                      guess
                        ? getCellColor(guess.feedback[colIndex])
                        : isCurrentRow && letter
                        ? "bg-gray-200 dark:bg-gray-800 border-2 border-gray-400 dark:border-gray-500"
                        : "bg-gray-200 dark:bg-gray-800 border-2 border-gray-300 dark:border-gray-600"
                    }`}
                  >
                    {letter}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* Game Over Overlay - covers entire screen */}
        {isGameOver && (
          <div className="fixed inset-0 bg-gray-900/30 dark:bg-gray-900/50 z-50 pointer-events-auto flex flex-col items-center justify-center">
            <div className="text-center">
              <p className="text-2xl font-bold mb-6 text-gray-900 dark:text-gray-100">
                {guesses.some((g) => g.feedback.every((f) => f === "correct"))
                  ? "🎉 Congratulations! You won!"
                  : "Game Over! Try again tomorrow."}
              </p>
              <button
                onClick={handleShare}
                className="px-6 py-3 bg-green-500 text-white rounded hover:bg-green-600 transition-colors font-semibold"
              >
                {shareSuccess ? "✓ Copied!" : "Share Results"}
              </button>
            </div>
          </div>
        )}

        {/* <div className="flex flex-col items-center gap-4">
          <div className="flex gap-2">
            <button
              onClick={handleSubmitGuess}
              disabled={
                currentGuess.length !== 5 ||
                isLoading ||
                isGameOver ||
                guesses.length >= 6
              }
              className="px-6 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              {isLoading ? "Checking..." : "Submit"}
            </button>
            <button
              onClick={() => setCurrentGuess("")}
              disabled={currentGuess.length === 0 || isLoading || isGameOver}
              className="px-6 py-2 bg-gray-500 text-white rounded hover:bg-gray-600 disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              Clear
            </button>
          </div>

          <div className="text-sm text-gray-600 dark:text-gray-400">
            Type your guess and press Enter, or click Submit
          </div>
        </div> */}

        {/* Virtual Keyboard */}
        <div className="flex flex-col gap-2 mt-8 w-full">
          {keyboardRows.map((row, rowIndex) => (
            <div
              key={rowIndex}
              className="flex justify-center gap-1.5"
              style={{
                marginLeft: rowIndex === 2 ? "1.5rem" : "0",
              }}
            >
              {row.map((letter) => (
                <button
                  key={letter}
                  onClick={() => handleKeyPress(letter)}
                  disabled={isGameOver || isLoading}
                  className={`min-w-8 h-10 px-2 text-sm font-semibold rounded transition-colors ${getKeyColor(
                    letter
                  )} disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-80 active:scale-95`}
                >
                  {letter}
                </button>
              ))}
            </div>
          ))}
          <div className="flex justify-center gap-1.5 mt-2">
            <button
              onClick={() => handleKeyPress("Enter")}
              disabled={
                currentGuess.length !== 5 ||
                isGameOver ||
                isLoading ||
                guesses.length >= 6
              }
              className="min-w-16 h-10 px-4 text-xs font-semibold rounded bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100 disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-80 active:scale-95"
            >
              ENTER
            </button>
            <button
              onClick={() => handleKeyPress("Backspace")}
              disabled={currentGuess.length === 0 || isGameOver || isLoading}
              className="min-w-16 h-10 px-4 text-xs font-semibold rounded bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100 disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-80 active:scale-95"
            >
              ⌫
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
