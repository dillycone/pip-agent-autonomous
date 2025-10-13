# Security Guidelines

## Overview

This document outlines security best practices for deploying and maintaining the PIP Agent application.

## API Key Management

### Development

**Never commit API keys to version control:**
- The `.env` file is already in `.gitignore`
- Always use `.env.example` as a template
- Never hardcode API keys in source code

**Obtaining API Keys:**
- Anthropic API Key: https://console.anthropic.com/
- Google Gemini API Key: https://aistudio.google.com/app/apikey

**API Key Format Validation:**
The application validates API key formats at startup:
- Anthropic keys must start with `sk-ant-` (at least 40 characters)
- Gemini keys must start with `AIza` (at least 35 characters)

If you see format validation errors, verify you've copied the complete key.

### Production Deployments

**Use a Secrets Manager:**

For production, **never** use `.env` files. Instead, use a secrets management service:

**AWS:**
```bash
# Store secrets in AWS Secrets Manager
aws secretsmanager create-secret \
  --name pip-agent/anthropic-key \
  --secret-string "sk-ant-..."

aws secretsmanager create-secret \
  --name pip-agent/gemini-key \
  --secret-string "AIza..."

# Retrieve in your application
ANTHROPIC_API_KEY=$(aws secretsmanager get-secret-value \
  --secret-id pip-agent/anthropic-key \
  --query SecretString --output text)
```

**Google Cloud:**
```bash
# Store secrets in Google Secret Manager
echo -n "sk-ant-..." | gcloud secrets create anthropic-key --data-file=-
echo -n "AIza..." | gcloud secrets create gemini-key --data-file=-

# Grant access to your service account
gcloud secrets add-iam-policy-binding anthropic-key \
  --member="serviceAccount:your-sa@project.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

**Azure:**
```bash
# Store secrets in Azure Key Vault
az keyvault secret set \
  --vault-name your-vault \
  --name anthropic-key \
  --value "sk-ant-..."

az keyvault secret set \
  --vault-name your-vault \
  --name gemini-key \
  --value "AIza..."
```

**Docker/Kubernetes:**
```yaml
# Use Kubernetes secrets (not environment variables)
apiVersion: v1
kind: Secret
metadata:
  name: api-keys
type: Opaque
stringData:
  anthropic-key: sk-ant-...
  gemini-key: AIza...

---
apiVersion: v1
kind: Pod
spec:
  containers:
  - name: pip-agent
    env:
    - name: ANTHROPIC_API_KEY
      valueFrom:
        secretKeyRef:
          name: api-keys
          key: anthropic-key
    - name: GEMINI_API_KEY
      valueFrom:
        secretKeyRef:
          name: api-keys
          key: gemini-key
```

### Key Rotation

**If API keys are ever exposed:**

1. **Immediately revoke** the compromised keys:
   - Anthropic: https://console.anthropic.com/
   - Gemini: https://aistudio.google.com/app/apikey

2. **Generate new keys** from the respective consoles

3. **Update your secrets manager** or `.env` file

4. **Monitor for unauthorized usage** in your API provider's dashboard

## Input Validation

The application implements comprehensive input validation:

### File Path Security

All file paths are validated to prevent path traversal attacks:

```typescript
// Blocks dangerous patterns
// - Path traversal: ../, ~/, etc.
// - Command injection: $(command), `command`, etc.
// - Sensitive system files: /etc/passwd, .ssh/id_rsa, etc.
```

**Safe file operations:**
```bash
# Good - relative paths within project
--audio uploads/meeting.mp3
--template templates/pip-template.docx
--outdoc exports/output.docx

# Bad - will be rejected
--audio ../../../etc/passwd
--audio ~/sensitive/file.mp3
```

### Audio File Validation

Only whitelisted audio formats are accepted:
- `.mp3`, `.wav`, `.flac`, `.m4a`, `.aac`
- `.ogg`, `.opus`, `.wma`, `.aiff`, `.ape`, `.ac3`

Maximum file size: 200MB

### Command Execution Security

The application uses a **command whitelist** approach:
- Only `ffmpeg` and `ffprobe` can be executed
- All arguments are validated before execution
- No shell interpretation (uses `spawn()` not `exec()`)
- Timeout and buffer limits prevent resource exhaustion

## Error Handling

### Information Disclosure Prevention

The application sanitizes all error messages:

**API Keys:** Automatically redacted from logs and error messages
```
Pattern: sk-[a-zA-Z0-9]{32,} → [REDACTED]
Pattern: AIza[a-zA-Z0-9_-]{35} → [REDACTED]
```

**File Paths:** User-specific paths are sanitized
```
/Users/username/... → ~/...
/home/username/... → ~/...
```

**Sensitive Fields:** Filtered from logs
```
password, apiKey, token, secret, authorization, credential
```

## Dependencies

### Keeping Dependencies Updated

```bash
# Check for vulnerabilities
npm audit

# Update dependencies
npm update

# Update to specific secure versions
npm install pino@10.0.0
```

### Current Security Status

- **0 vulnerabilities** (as of last audit with pino 10.0.0)
- All dependencies are from trusted sources
- Regular security updates recommended

## Network Security

### Outbound Connections

The application makes HTTPS requests to:
- `api.anthropic.com` (Claude API)
- `generativelanguage.googleapis.com` (Gemini API)

**Firewall rules (if needed):**
```bash
# Allow outbound HTTPS to API endpoints
iptables -A OUTPUT -p tcp --dport 443 -d api.anthropic.com -j ACCEPT
iptables -A OUTPUT -p tcp --dport 443 -d generativelanguage.googleapis.com -j ACCEPT
```

## Audit Logging

The application logs all operations:
- File access and validation
- API calls (with token counts)
- Tool executions
- Errors and warnings

**Production logging recommendations:**
1. Enable structured JSON logging (`LOG_LEVEL=info`)
2. Ship logs to a centralized system (CloudWatch, Stackdriver, etc.)
3. Set up alerts for error patterns
4. Retain logs for compliance requirements

## Data Privacy

### Audio File Handling

**Storage:**
- Audio files are processed locally
- Files are sent to Gemini API for transcription
- Temporary chunks are created in system temp directory
- All temporary files are cleaned up after processing

**Retention:**
- Original audio files remain in `uploads/` directory
- You are responsible for deleting audio files after use
- Consider encrypting audio files at rest if they contain sensitive information

### Transcript Data

**Processing:**
- Transcripts are sent to Claude API for PIP generation
- No data is stored by this application beyond the final DOCX output
- Review API provider data retention policies:
  - Anthropic: https://www.anthropic.com/legal/privacy
  - Google: https://ai.google.dev/gemini-api/terms

## Secure Development Practices

### Code Review Checklist

Before deploying changes:

- [ ] No API keys or secrets in code
- [ ] All file paths validated with `validateFilePath()`
- [ ] No use of `child_process.exec()` or shell strings
- [ ] Error messages sanitized (no sensitive data)
- [ ] Input validation for all user-provided data
- [ ] Dependencies updated and audited
- [ ] Tests pass (if applicable)

### Security Testing

```bash
# Run dependency audit
npm audit

# Check for secrets in code (using git-secrets or similar)
git secrets --scan

# Validate all environment variables are loaded
npm run dev 2>&1 | grep -i "missing\|invalid"
```

## Incident Response

### If a Security Issue is Discovered

1. **Do not publicly disclose** the issue
2. Contact the maintainers privately
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if available)

### If Your Deployment is Compromised

1. **Rotate all API keys immediately**
2. Review access logs for unauthorized usage
3. Check for data exfiltration
4. Update to the latest version
5. Review and strengthen access controls
6. Document the incident for compliance

## Compliance Considerations

### GDPR / Data Protection

- Ensure you have consent to process HR meeting recordings
- Implement data retention policies
- Provide data deletion mechanisms
- Document data processing activities

### Industry-Specific Requirements

**Healthcare (HIPAA):**
- This application is **not HIPAA-compliant** out of the box
- Do not use for processing PHI without proper BAAs
- Review API provider compliance certifications

**Finance (PCI-DSS, SOX):**
- Ensure proper access controls
- Implement audit logging
- Review third-party risk assessments

## Additional Resources

- [Anthropic Security Best Practices](https://docs.anthropic.com/security)
- [Google Cloud Security](https://cloud.google.com/security/best-practices)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Node.js Security Best Practices](https://nodejs.org/en/docs/guides/security/)

## Contact

For security concerns, contact the repository maintainers or file a security advisory on GitHub.
