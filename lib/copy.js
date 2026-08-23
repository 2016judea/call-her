// Every outbound string lives here. One file, so the voice can be read
// end to end and edited without hunting through logic.
//
// House rules: short enough to read on a lock screen, no marketing, no
// exclamation marks, no emoji. It is a friend with a clipboard, not a brand.
//
// What this is FOR, because a previous version of this file got it backwards:
// the journal going to your small group is the product. Journaling is good;
// journaling to the handful of people you let in is better. The two-week
// question is a nudge, not the mechanism, and it is the creator's one update
// to give — never the room interrogating him. See README.md, which is Aidan's
// brief and outranks anything here.

export const MAX_CIRCLE = 8;   // carrier caps the room at 10, incl. them and us

export const copy = {
  // --- creator onboarding ---
  welcome: () =>
    `This is Call Her. After a first date you text me how it went, and I put ` +
    `it in the group chat with the few friends you'd have told anyway. Two ` +
    `weeks later I ask you what you did.\n\n` +
    `What should they see you as? Reply with a first name.`,

  // `invite` is supplied by the channel: how someone actually joins a circle
  // differs per channel, and hardcoding the SMS answer here put a useless join
  // code in front of a Telegram user on the first live test (2026-08-23).
  handleSet: (handle, invite) =>
    `Got it, ${handle}. Now your circle — the people you'd text anyway.\n\n${invite}`,

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

  cantInviteHere: (invite) =>
    `That's not how it works on this one.\n\n${invite}`,

  badCode: () =>
    `I don't know that code. Check the last 4 characters and try again — ` +
    `it looks like  join k7m2`,

  // --- entries ---
  noCircleYet: (invite) =>
    `Hold that. You've got nobody in your circle yet, so there's no room to ` +
    `put it in.\n\n${invite}`,

  tooShort: () =>
    `Give me a bit more than that — a few sentences on how it went.`,

  // The entry is going to the room either way. The only choice is whether the
  // room is asked to let him decide first — his own brief: "If you have opted
  // into feedback immediately after your date you will see your buddies
  // replies as they come in."
  askMode: (count) =>
    `Going to your ${count}. Their replies as they come, or should I ask them ` +
    `to let you decide first?\n\nReply NOW or WAIT.`,

  modeNow: (whenOutcome) =>
    `In the room. I'll come back to you ${whenOutcome} for what happened.`,

  modeWait: (whenQuiet, whenOutcome) =>
    `In the room, with a note that you're not reading it till ${whenQuiet}. ` +
    `I'll come back to you ${whenOutcome} for what happened.`,

  nudgeMode: () => `NOW or WAIT.`,

  // He never answered NOW or WAIT. The entry still belongs in the room — a
  // journal nobody read is the one outcome this product cannot produce.
  modeLapsed: (whenOutcome) =>
    `You never said, so I put it in the room as it was. I'll come back to you ` +
    `${whenOutcome} for what happened.`,

  // --- the one update ---
  askOutcome: () => `Two weeks. Your turn — what happened? One line is plenty.`,

  posted: () => `In the room. That's your one update.`,

  // --- what lands in the room ---
  groupEntry: (handle, body) => `${handle}, after a first date:\n\n"${body}"`,

  groupEntryHeld: (handle, body, whenQuiet) =>
    `${handle}, after a first date:\n\n"${body}"\n\n` +
    `${handle} isn't reading this till ${whenQuiet} — talk among yourselves.`,

  groupOutcome: (handle, outcome) => `${handle}, two weeks on:\n\n"${outcome}"`,

  groupOpened: (handle) =>
    `This is ${handle}'s circle on Call Her. ${handle} will post here after a ` +
    `first date. Reply like any group text — it stays between the people in it.`,

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
    `Call Her: after a first date you text me how it went, I put it in a group ` +
    `chat with friends you chose, and two weeks later I ask what you did. ` +
    `Free. Reply STOP to leave and I'll delete you. ` +
    `Questions: aidan@brickandmortar.dev`,

  stopped: () => `Done — you're out and I've dropped your number. Text START to come back.`,

  restarted: () => `Welcome back.`,
};
