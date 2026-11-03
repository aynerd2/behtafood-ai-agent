// Limits the app shares with the server.

/** The server refuses longer messages (agent-core MAX_USER_CHARS). */
export const MAX_MESSAGE_CHARS = 500;

/**
 * The text sent with a photo that has no words. The server needs some text;
 * the chat does not show this one (the photo speaks for itself).
 */
export const PHOTO_ONLY_TEXT = 'Find me something like this.';
