# Claude Agent SDK Features - Quick Reference Guide

## 🎯 What's New in Your Pipeline

This guide shows you how to use the new SDK-aligned features added to your PIP agent.

---

## 📊 Cost Tracking

### What it does
Tracks all API token usage and calculates estimated costs in real-time.

### Output
```bash
📊 Cost Summary:
  Total Tokens: 45,234
  Input Tokens: 12,450
  Output Tokens: 2,784
  Cache Creation: 28,000
  Cache Read: 2,000
  Estimated Cost: $0.2845
```

### Cost Breakdown
- **Input tokens**: Your prompts and context
- **Output tokens**: Claude's responses
- **Cache creation**: First-time prompt caching
- **Cache read**: Reusing cached prompts (cheaper!)

### Pricing (as of 2025)
- Input: $3.00 per 1M tokens
- Output: $15.00 per 1M tokens
- Cache creation: $3.75 per 1M tokens
- Cache read: $0.30 per 1M tokens

### How to optimize costs
1. Use caching for repeated prompts
2. Keep prompts concise
3. Monitor the cost summary after each run
4. Set budget alerts (future enhancement)

---

## ✅ Progress Tracking

### What it does
Shows real-time progress as the agent works through pipeline steps.

### Output
```bash
✓ Progress: 3/6 tasks completed
  ⏳ Generating PIP draft from transcript
  ⏳ Reviewing draft against policy guidelines
```

### When you'll see it
- Agent breaks down complex tasks into subtasks
- Each subtask shows as pending → in_progress → completed
- Great for long-running pipelines

### No todos?
If you don't see todos, the agent chose not to use them (usually for simple, linear tasks).

---

## 🔧 Tool Execution Visibility

### What it does
Shows you exactly which tools are being called and when.

### Output
```bash
🔧 Tool: mcp__gemini-transcriber__transcribe_audio
🔧 Tool: mcp__pip-generator__draft_pip
⚠️  Tool mcp__pip-generator__draft_pip returned error
```

### Available tools
1. **gemini-transcriber** - Transcribes audio with Gemini 2.5 Pro
2. **pip-generator** - Drafts PIP using Claude Sonnet 4.5
3. **docx-exporter** - Generates final DOCX document

### Debugging tool errors
When you see `⚠️ Tool returned error`:
1. Check the tool's error message in the output
2. Verify input files exist (audio, template)
3. Check API keys are set
4. Review the tool's specific requirements

---

## 📝 Session Management

### What it does
Saves your session ID so you can resume if the pipeline fails.

### Output
```bash
📝 Session ID: session-abc123def456
...
💾 To resume this session: Set RESUME_SESSION_ID=session-abc123def456
```

### How to resume (when implemented)
```bash
# Set the session ID from failed run
export RESUME_SESSION_ID=session-abc123def456

# Run again - it will resume from where it stopped
npm run dev
```

### Use cases
- Network interruption during long transcription
- API rate limiting
- Debugging specific pipeline steps
- Saving partial results

---

## 🧠 Agent Reasoning Visibility

### What it does
Shows the agent's thought process as it works.

### Output
```bash
💭 I'll start by transcribing the audio file...
💭 Transcription complete. Now generating PIP draft...
💭 Draft generated. Sending to policy judge for review...
```

### What gets logged
- Agent's planning and reasoning
- Decisions about which tools to use
- Error handling and recovery attempts
- Final result JSON (if agent chooses to output it)

---

## 🎨 Rich Console Output

### What it means
Visual indicators help you quickly scan pipeline status:

```bash
🚀 Starting...       # Pipeline initialization
📝 Session ID        # Session tracking
🔧 Tool:             # Tool execution
✓ Progress:          # Task completion
💭 Reasoning:        # Agent thoughts
⚠️  Tool error:      # Tool failed
❌ Run error:        # Pipeline failed
📊 Cost Summary:     # Final costs
✅ Completed:        # Success!
💾 To resume:        # Session saved
```

---

## 🏗️ Architecture Overview

### Message Flow
```
User Input
    ↓
Query (Claude Agent SDK)
    ↓
Stream of Messages:
  - system (session ID)
  - stream_event (tool use/results)
  - assistant (reasoning)
  - result (final output)
    ↓
Message Processors:
  - CostTracker (tracks tokens)
  - TodoTracker (tracks progress)
  - Console logger (user output)
    ↓
Final Result + Summary
```

### Key Classes

#### CostTracker
```typescript
// Tracks all token usage
costTracker.processMessage(message)  // Call for each message
costTracker.printSummary()           // Print final costs
```

#### TodoTracker
```typescript
// Tracks task progress
todoTracker.update(todos)            // Update task list
todoTracker.printProgress()          // Show progress
```

---

## 🔬 Debugging Tips

### Enable verbose output
All observability is already enabled! You'll see:
- Tool execution
- Progress updates
- Cost tracking
- Error messages

### Check costs are reasonable
Typical run should be:
- Transcription: ~5,000-15,000 tokens
- PIP generation: ~2,000-5,000 tokens
- Policy review: ~1,000-3,000 tokens
- **Total: ~$0.10-$0.50 per run**

If costs are much higher:
- Check audio file length (longer = more tokens)
- Review PIP template complexity
- Look for retry loops in policy judge

### Tool execution issues
```bash
# If transcription fails:
- Check GEMINI_API_KEY is set
- Verify audio file exists and is valid
- Check ffmpeg is installed (for chunking)

# If PIP generation fails:
- Check ANTHROPIC_API_KEY is set
- Verify prompts/draft-pip.txt exists
- Check transcript isn't empty

# If DOCX export fails:
- Verify template exists (or remove --template flag)
- Check exports/ directory is writable
```

### Session tracking not working?
Session ID should appear early in output:
```bash
📝 Session ID: session-...
```

If missing:
- Check you're using Agent SDK 0.1.14+
- Verify `system` messages are being logged
- May need SDK update for full support

---

## 📈 Monitoring in Production

### Key metrics to watch
1. **Total cost per run** - Budget control
2. **Token usage trends** - Optimization opportunities
3. **Tool error rates** - Reliability monitoring
4. **Average run time** - Performance tracking

### Example monitoring script
```bash
#!/bin/bash
# Run pipeline and extract costs
npm run dev 2>&1 | tee run.log
grep "Estimated Cost" run.log | tail -1
```

### Cost alerts (future)
Could add:
```typescript
if (cost.estimatedCostUSD > COST_THRESHOLD) {
  sendAlert(`High cost: $${cost.estimatedCostUSD}`);
}
```

---

## 🔄 Workflow Examples

### Basic run
```bash
npm run dev -- \
  --audio uploads/meeting.mp3 \
  --in en-US \
  --out en
```

### With template
```bash
npm run dev -- \
  --audio uploads/meeting.mp3 \
  --template templates/pip-template.docx \
  --outdoc exports/Q1-PIP.docx
```

### Watch for specific costs
```bash
npm run dev 2>&1 | grep -E "(Cost|Progress|Tool)"
```

---

## 🎓 SDK Concepts Explained

### What is the Agent SDK?
Think of it as a wrapper around Claude that adds:
- **Tool use** - Claude can call your MCP functions
- **Subagents** - Specialized AIs for specific tasks
- **Streaming** - Real-time responses as they're generated
- **Session management** - Resume and fork conversations

### What are MCP servers?
Model Context Protocol servers expose tools to Claude:
```typescript
// Your MCP server:
geminiTranscriber
  └─ transcribe_audio tool

// Claude can now:
"I'll use mcp__gemini-transcriber__transcribe_audio to..."
```

### What are subagents?
Specialized AIs with focused instructions:
```typescript
// Your subagent:
policy-judge
  └─ Reviews PIP for compliance
  └─ Returns: { approved: boolean, reasons: [...] }

// Main agent can delegate:
"Send this draft to the policy-judge subagent for review"
```

---

## 🚀 Performance Tips

### Reduce latency
- Use shorter audio files (or chunking will auto-enable)
- Keep PIP template simple
- Reduce MAX_REVIEW_ROUNDS if approval isn't critical

### Reduce costs
- Use prompt caching (automatic in SDK)
- Optimize prompts to be concise
- Reduce output language translation if not needed

### Increase reliability
- Monitor tool error rates
- Set appropriate timeouts
- Use session resumption for long pipelines

---

## 🆘 Common Issues

### "Missing ANTHROPIC_API_KEY"
```bash
# Add to .env:
ANTHROPIC_API_KEY=sk-ant-...
```

### "Missing GEMINI_API_KEY"
```bash
# Add to .env:
GEMINI_API_KEY=AIza...
```

### "Audio not found"
```bash
# Check file exists:
ls -l uploads/meeting.mp3

# Or specify full path:
npm run dev -- --audio /full/path/to/audio.mp3
```

### "Template errors"
```bash
# Use fallback (no template):
npm run dev -- --audio uploads/meeting.mp3
# (removes --template flag)
```

### Costs higher than expected
- Check `Cache Read` tokens - should be high on repeated runs
- Review transcript length in output
- Consider shorter audio clips for testing

---

## 📚 Additional Resources

- [Claude Agent SDK Docs](https://docs.claude.com/en/api/agent-sdk/overview)
- [MCP Documentation](https://docs.claude.com/en/api/agent-sdk/mcp)
- [Cost Optimization Guide](https://docs.anthropic.com/en/api/pricing)
- [Subagent Patterns](https://docs.claude.com/en/api/agent-sdk/subagents)

---

## 💡 Pro Tips

1. **Test with short audio first** - Validate pipeline before running expensive transcriptions
2. **Watch the cost summary** - Track spending trends over time
3. **Use session IDs** - Save for debugging failed runs
4. **Monitor todo progress** - Helps identify bottlenecks
5. **Check tool execution** - Ensure MCP servers are working correctly

---

Happy building! 🎉

For questions or issues, check:
- `IMPROVEMENTS_SUMMARY.md` - Full list of changes
- `README.md` - Original project documentation
- GitHub Issues - Report bugs or request features
