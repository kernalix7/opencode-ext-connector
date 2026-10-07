export const signal = new AbortController().signal
export const stored = (accessToken: string, refreshToken = "refresh") =>
  JSON.stringify({ accessToken, refreshToken, expiresAt: 0 })
export const success = (accessToken: string) => ({
  status: 200,
  headers: {},
  body: new TextEncoder().encode(JSON.stringify({ access_token: accessToken, expires_in: 3600 })),
})
