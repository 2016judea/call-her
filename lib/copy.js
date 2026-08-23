// Every outbound string lives here. One file, so the voice can be read
// end to end and edited without hunting through logic.
//
// House rules: short enough to read on a lock screen, no marketing, no
// exclamation marks, no emoji. It is a friend with a clipboard, not a brand.

import { pretty } from './phone.js';

export const MAX_CIRCLE = 8;   // carrier caps the room at 10, incl. them and us

export const copy = {
  // --- creator onboarding ---
  welcome: () =>
    `This is Call Her. After a first date you text me what happened, and I ` +
    `put it in a group text with the few friends you'd have told anyway.\n\n` +
    `What should they see you as? Reply with a first name.`,

  handleSet: (handle, code, ourNumber) =>
    `Got it, ${handle}. Now your circle — the people you'd text anyway.\n\n` +
    `Send them this:\n` +
    `"Text  join ${code}  to ${pretty(ourNumber)}"\n\n` +
    `Up to ${MAX_CIRCLE}. I'll tell you as they land.`,

  nudgeHandle: () => `Just a first name is fine — whatever your friends call you.`,

  // --- circle ---
  inviteSent: (ownerHandle) =>
    `${ownerHandle} added you to their circle on Call Her. You'll get their ` +
    `first-date journals and can reply in the group.\n\n` +
    `Reply YES to join, NO to pass. STOP anytime.`,

  inviteAccepted: (ownerHandle) =>
    `You're in. Nothing to do — I'll text when ${ownerHandle} posts.`,

  inviteDeclined: () => `No problem. You won't hear from me again.`,

  circleGrew: (name, count) =>
    count === 1
      ? `${name} is in. That's your circle of 1 — you can post any time.`
      : `${name} is in. Circle of ${count}.`,

  circleFull: (ownerHandle) =>
    `${ownerHandle}'s circle is full (${MAX_CIRCLE}). Nothing I can do from here.`,

  badCode: () =>
    `I don't know that code. Check the last 4 characters and try again — ` +
    `it looks like  join k7m2`,

  // --- entries ---
  noCircleYet: (code, ourNumber) =>
    `Hold that. You've got nobody in your circle yet, so there's no room to ` +
    `put it in.\n\nSend a friend this:\n"Text  join ${code}  to ${pretty(ourNumber)}"\n\n` +
    `Then text me again.`,

  tooShort: () =>
    `Give me a bit more than that — a few sentences on how it went.`,

  askMode: (count) =>
    `Got it. Open it to your ${count} now, or hold it a week so you decide ` +
    `first?\n\nReply NOW or WAIT.`,

  modeNow: (when) => `Open. I'll check in with the group on ${when}.`,

  modeWait: (when) =>
    `Held. Your circle sees it ${when} — until then the call is yours alone.`,

  nudgeMode: () => `NOW or WAIT.`,

  // --- the mechanism ---
  chaseGroup: (handle) =>
    `A week ago ${handle} wrote about this one. ${handle} — did you call her?`,

  askOutcome: () =>
    `Your entry goes to the circle today. Before it does: what happened? ` +
    `One line is plenty.`,

  posted: () => `Posted.`,

  // --- what lands in the room ---
  groupEntry: (handle, body) => `${handle}, after a first date:\n\n"${body}"`,

  groupEntryWithOutcome: (handle, body, outcome) =>
    `${handle}, after a first date last week:\n\n"${body}"\n\nWhat he did: ${outcome}`,

  groupOpened: (handle) =>
    `This is ${handle}'s circle on Call Her. They'll post here after a first ` +
    `date. Reply like any group text. It stays between the people in it.`,

  // --- the guards ---
  scrubbedNames: (n) =>
    n === 1
      ? `I took a name out before posting — she didn't sign up for this.`
      : `I took ${n} names out before posting — they didn't sign up for this.`,

  refusedExplicit: () =>
    `I can't send that one. Phone carriers block explicit content, and one ` +
    `flag takes the number down for everybody using this. Rewrite it and ` +
    `send it again.`,

  // --- compliance ---
  help: (ourNumber) =>
    `Call Her: you text a journal entry after a first date, I post it to a ` +
    `group text with friends you chose. Free. Reply STOP to leave and I'll ` +
    `delete you. Questions: aidan@brickandmortar.dev`,

  stopped: () => `Done — you're out and I've dropped your number. Text START to come back.`,

  restarted: () => `Welcome back.`,
};
