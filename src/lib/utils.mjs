/**
 * Converts a string from snake_case to camelCase.
 * @param {string} str - The string to convert.
 * @returns {string} - The converted string.
 */
export function camelToSnakeCase(str) {
  return str.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`).slice(1);
}

/**
 * Sleeps for a given amount of time.
 * @param {number} ms - The amount of time to sleep in milliseconds.
 * @returns {Promise<void>}
 */
export async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Splits a string into an array of substrings based on commas, while respecting
 * @param {string} input - The input string to split.
 * @returns {string[]} - An array of substrings.
 */
export function splitString(input) {
  const result = [];
  let current = "";
  let inQuotes = false;
  let inBrackets = 0;
  let inBraces = 0;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (char === '"' && input[i - 1] !== "\\") {
      inQuotes = !inQuotes;
    } else if (!inQuotes) {
      if (char === "[") {
        inBrackets++;
      } else if (char === "]") {
        inBrackets--;
      } else if (char === "{") {
        inBraces++;
      } else if (char === "}") {
        inBraces--;
      } else if (char === "," && inBrackets === 0 && inBraces === 0) {
        result.push(current.trim());
        current = "";
        continue;
      }
    }

    current += char;
  }

  if (current) {
    result.push(current.trim());
  }

  return result;
}
