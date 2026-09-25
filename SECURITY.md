# Security

## API Credentials

**Never commit API credentials to version control.**

- Store `GUESTY_CLIENT_ID` and `GUESTY_CLIENT_SECRET` as environment variables
- Use `.env` files locally (already in `.gitignore`)
- Use secrets management in production (Docker secrets, AWS SSM, etc.)

## Token Handling

- OAuth2 tokens are cached in memory with automatic refresh
- Tokens expire after 24 hours
- Token cache file (`.token-cache.json`) is gitignored

## API Access

- The server uses OAuth2 client credentials flow
- All API calls go through HTTPS
- Rate limiting is handled with automatic retry

## Reporting Vulnerabilities

If you discover a security vulnerability, please email security@cohoststr.com rather than opening a public issue.
