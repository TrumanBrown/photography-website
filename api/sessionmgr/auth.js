function allowedUsers(configuredValue) {
  const value = configuredValue || "";
  return new Set(
    value
      .toLowerCase()
      .split(",")
      .map((username) => username.trim())
      .filter(Boolean),
  );
}

function principalUserId(header) {
  if (typeof header !== "string" || !header) return "";

  try {
    const principal = JSON.parse(
      Buffer.from(header, "base64").toString("utf8"),
    );
    return principal.identityProvider === "github" &&
      typeof principal.userDetails === "string"
      ? principal.userDetails.trim().toLowerCase()
      : "";
  } catch {
    return "";
  }
}

module.exports = { allowedUsers, principalUserId };
