export class LeetCodeUserNotFoundError extends Error {
  constructor(username: string) {
    super(`LeetCode user "${username}" doesn't exist.`);
    this.name = "LeetCodeUserNotFoundError";
  }
}

export class LeetCodeUnavailableError extends Error {
  constructor(username: string) {
    super(`Couldn't reach LeetCode for "${username}". Please try again.`);
    this.name = "LeetCodeUnavailableError";
  }
}
