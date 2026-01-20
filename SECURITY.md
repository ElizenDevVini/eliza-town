# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Eliza Town, please report it responsibly.

**Do NOT open a public issue for security vulnerabilities.**

Instead, please email the maintainers directly or use GitHub's private vulnerability reporting feature.

## Security Best Practices

When deploying Eliza Town:

1. **Never commit `.env` files** - They are gitignored by default
2. **Use environment variables** for all secrets
3. **Keep dependencies updated** - Run `npm audit` regularly
4. **Use HTTPS** in production
5. **Restrict database access** - Use strong passwords and network rules

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| latest  | :white_check_mark: |

## Known Considerations

- The application runs in simulation mode without an API key
- Database credentials should be kept secure
- WebSocket connections should be secured in production
