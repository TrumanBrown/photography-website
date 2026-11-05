const {
  notify,
  buildNotification,
  readSettings,
  cleanPage,
  oneLine,
  MAX_PER_HOUR,
} = require("./notify");

const ENV = {
  CONTACT_EMAIL_CONNECTION_STRING:
    "endpoint=https://acs.example/;accesskey=a2V5",
  CONTACT_EMAIL_FROM: "DoNotReply@example.azurecomm.net",
  CONTACT_NOTIFY_TO: "me@example.com",
};

const ENTRY = {
  name: "Ada Lovelace",
  email: "ada@example.com",
  message: "Is the heron print available in 16 x 24?",
  page: "/sessions/costa-rica-tortuguero/#4",
  submittedAt: "2026-11-05T21:00:00.000Z",
};

describe("readSettings", () => {
  it("needs all three settings", () => {
    expect(readSettings(ENV)).toEqual({
      connectionString: ENV.CONTACT_EMAIL_CONNECTION_STRING,
      from: ENV.CONTACT_EMAIL_FROM,
      to: ENV.CONTACT_NOTIFY_TO,
    });
    expect(readSettings({ ...ENV, CONTACT_NOTIFY_TO: " " })).toBeNull();
    expect(readSettings({})).toBeNull();
  });
});

describe("buildNotification", () => {
  const email = buildNotification(ENTRY, readSettings(ENV));

  it("goes to me, from the sender, with the visitor to reply to", () => {
    expect(email.senderAddress).toBe(ENV.CONTACT_EMAIL_FROM);
    expect(email.recipients).toEqual({ to: [{ address: "me@example.com" }] });
    expect(email.replyTo).toEqual([
      { address: "ada@example.com", displayName: "Ada Lovelace" },
    ]);
  });

  it("names the sender in the subject and keeps the whole message", () => {
    expect(email.content.subject).toBe(
      "New message from Ada Lovelace on trumanbrown.com",
    );
    expect(email.content.plainText.startsWith(ENTRY.message)).toBe(true);
    expect(email.content.plainText).toContain(
      "From Ada Lovelace <ada@example.com>",
    );
    expect(email.content.plainText).toContain(
      "https://trumanbrown.com/sessions/costa-rica-tortuguero/#4",
    );
  });

  it("can't be split into extra headers by a crafted name", () => {
    const sneaky = buildNotification(
      { ...ENTRY, name: "Eve\r\nBcc: everyone@example.com" },
      readSettings(ENV),
    );
    expect(sneaky.content.subject).not.toMatch(/[\r\n]/);
    expect(sneaky.replyTo[0].displayName).not.toMatch(/[\r\n]/);
  });

  it("shortens a long name in the subject", () => {
    const long = buildNotification(
      { ...ENTRY, name: "x".repeat(300) },
      readSettings(ENV),
    );
    expect(long.content.subject.length).toBeLessThan(110);
  });
});

describe("cleanPage and oneLine", () => {
  it("keeps site paths and drops anything else", () => {
    expect(cleanPage("/hobbies/tide-pooling/")).toBe("/hobbies/tide-pooling/");
    expect(cleanPage("https://evil.example/")).toBe("");
    expect(cleanPage("/<script>")).toBe("");
    expect(cleanPage(undefined)).toBe("");
  });

  it("flattens whitespace and control characters", () => {
    expect(oneLine("  a\n\tb  ", 20)).toBe("a b");
    expect(oneLine("abcdefghij", 8)).toBe("abcde...");
  });
});

describe("notify", () => {
  it("skips quietly when it isn't configured", async () => {
    let called = false;
    const result = await notify(ENTRY, {
      env: {},
      send: async () => {
        called = true;
      },
    });
    expect(result).toBe("skipped");
    expect(called).toBe(false);
  });

  it("sends once under the hourly ceiling", async () => {
    const sent = [];
    let asked = 0;
    const result = await notify(ENTRY, {
      env: ENV,
      limit: async (max) => {
        asked = max;
        return false;
      },
      send: async (message) => {
        sent.push(message);
      },
    });
    expect(result).toBe("sent");
    expect(asked).toBe(MAX_PER_HOUR);
    expect(sent).toHaveLength(1);
  });

  it("stops at the ceiling", async () => {
    const result = await notify(ENTRY, {
      env: ENV,
      limit: async () => true,
      send: async () => {
        throw new Error("should not send");
      },
    });
    expect(result).toBe("skipped");
  });

  it("still sends if the ceiling can't be checked", async () => {
    const result = await notify(ENTRY, {
      env: ENV,
      limit: async () => {
        throw new Error("table down");
      },
      send: async () => {},
    });
    expect(result).toBe("sent");
  });

  it("logs a failed send and never throws", async () => {
    const lines = [];
    const result = await notify(ENTRY, {
      env: ENV,
      send: async () => {
        throw new Error("401 Unauthorized");
      },
      log: (line) => lines.push(line),
    });
    expect(result).toBe("failed");
    expect(lines.join("\n")).toContain("401 Unauthorized");
  });
});
