# Voice

Voice input/output system with TTS, STT, and phone call integration.

## Table of Contents
- [Overview](#overview)
- [Text-to-Speech (TTS)](#text-to-speech-tts)
- [Speech-to-Text (STT)](#speech-to-text-stt)
- [Phone Calls](#phone-calls)
- [Character Voice Mapping](#character-voice-mapping)
- [Voice Pipeline](#voice-pipeline)
- [Configuration](#configuration)

## Overview

Vena's voice system provides:

**Text-to-Speech (TTS)** - Convert agent responses to audio
- ElevenLabs (high quality, natural voices)
- OpenAI TTS (fast, good quality)

**Speech-to-Text (STT)** - Transcribe voice messages to text
- Whisper (OpenAI, accurate)
- Deepgram (fast, real-time)

**Phone Calls** - Voice conversations via phone
- Twilio (phone call integration)
- Vapi (conversational AI calls)

**Character-Aware** - Each character has a distinct voice profile

**Auto-Reply** - Automatically respond with voice to voice messages

## Text-to-Speech (TTS)

Convert text to audio for agent responses.

### ElevenLabs

High-quality, natural-sounding voices.

**Setup:**

1. Get API key from https://elevenlabs.io/

2. Configure:
```json
{
  "voice": {
    "tts": {
      "provider": "elevenlabs",
      "apiKey": "${ELEVENLABS_API_KEY}",
      "defaultVoice": "adam",
      "model": "eleven_multilingual_v2"
    }
  }
}
```

3. Set environment variable:
```bash
export ELEVENLABS_API_KEY="..."
```

**Available voices:**
- `adam` - Deep, confident male voice
- `rachel` - Warm, clear female voice
- `josh` - Energetic, friendly male voice
- `sam` - Neutral, professional male voice
- `arnold` - Authoritative, measured male voice
- `bella` - Soft, expressive female voice
- `antoni` - Calm, thoughtful male voice
- `elli` - Young, bright female voice

See all voices: https://elevenlabs.io/voice-library

**Models:**
- `eleven_multilingual_v2` - Supports 29 languages (recommended)
- `eleven_monolingual_v1` - English only, fast

**Features:**
- Very natural prosody
- Emotional range
- Multiple languages
- Custom voice cloning
- Voice design

**Pricing:**
- Free tier: 10,000 characters/month
- Paid: Starts at $5/month

### OpenAI TTS

Fast, good quality TTS using OpenAI API.

**Setup:**

1. Use existing OpenAI API key

2. Configure:
```json
{
  "voice": {
    "tts": {
      "provider": "openai-tts",
      "apiKey": "${OPENAI_API_KEY}",
      "defaultVoice": "alloy",
      "model": "tts-1"
    }
  }
}
```

**Available voices:**
- `alloy` - Neutral
- `echo` - Male
- `fable` - British male
- `onyx` - Deep male
- `nova` - Female
- `shimmer` - Female

**Models:**
- `tts-1` - Fast, lower quality
- `tts-1-hd` - Slower, higher quality

**Features:**
- Fast generation
- Good quality
- Multiple voices
- Affordable

**Pricing:**
- $15 per 1M characters (tts-1)
- $30 per 1M characters (tts-1-hd)

### Voice Settings

**ElevenLabs settings:**
```json
{
  "voice": {
    "tts": {
      "provider": "elevenlabs",
      "stability": 0.5,
      "similarityBoost": 0.75,
      "outputFormat": "mp3"
    }
  }
}
```

- `stability` (0-1) - Voice consistency vs expressiveness
  - Low (0.3): More expressive, less consistent
  - High (0.8): More consistent, less expressive
- `similarityBoost` (0-1) - How closely to match voice
- `outputFormat` - `mp3`, `ogg_opus`, or `pcm`

## Speech-to-Text (STT)

Transcribe voice messages to text.

### Whisper (OpenAI)

Accurate, robust speech recognition.

**Setup:**

1. Use OpenAI API key

2. Configure:
```json
{
  "voice": {
    "stt": {
      "provider": "whisper",
      "apiKey": "${OPENAI_API_KEY}",
      "model": "whisper-1"
    }
  }
}
```

**Models:**
- `whisper-1` - Latest Whisper model

**Features:**
- High accuracy
- Supports 99 languages
- Robust to accents, noise
- Automatic language detection
- Timestamp support

**Pricing:**
- $0.006 per minute

**Languages:**
English, Spanish, French, German, Italian, Portuguese, Dutch, Russian, Chinese, Japanese, Korean, and 88+ more.

### Deepgram

Fast, real-time speech recognition.

**Setup:**

1. Get API key from https://deepgram.com/

2. Configure:
```json
{
  "voice": {
    "stt": {
      "provider": "deepgram",
      "apiKey": "${DEEPGRAM_API_KEY}",
      "model": "nova-2"
    }
  }
}
```

**Models:**
- `nova-2` - Latest, most accurate
- `nova` - Fast, accurate
- `base` - Budget option

**Features:**
- Very fast (real-time)
- High accuracy
- Multiple languages
- Speaker diarization
- Custom vocabulary

**Pricing:**
- Pay-as-you-go: $0.0043/min (nova-2)
- Free tier: $200 credit

## Phone Calls

Voice conversations via phone.

### Twilio

Programmable phone calls.

**Status:** Framework in place, coming soon.

**Setup:**

1. Create account at https://twilio.com/

2. Get credentials:
   - Account SID
   - Auth Token
   - Phone number

3. Configure:
```json
{
  "voice": {
    "calls": {
      "enabled": true,
      "provider": "twilio",
      "accountSid": "${TWILIO_ACCOUNT_SID}",
      "authToken": "${TWILIO_AUTH_TOKEN}",
      "phoneNumber": "${TWILIO_PHONE_NUMBER}"
    }
  }
}
```

**Features (planned):**
- Inbound calls (users call your bot)
- Outbound calls (bot calls users)
- Real-time voice conversation
- Call recording
- Voicemail transcription

### Vapi

Conversational AI phone calls.

**Status:** Coming soon.

**Setup:**

1. Create account at https://vapi.ai/

2. Get API key

3. Configure:
```json
{
  "voice": {
    "calls": {
      "enabled": true,
      "provider": "vapi",
      "apiKey": "${VAPI_API_KEY}"
    }
  }
}
```

**Features (planned):**
- Real-time conversational AI
- Low latency
- Built-in TTS/STT
- Phone number provisioning
- Call analytics

## Character Voice Mapping

Each character has a default voice that matches their personality.

### Character Voices

**Nova** (Direct peer)
- **ElevenLabs:** `adam` - Deep, confident
- **OpenAI:** `onyx` - Deep male
- Tone: Confident, direct

**Sage** (Patient teacher)
- **ElevenLabs:** `rachel` - Warm, clear
- **OpenAI:** `nova` - Female
- Tone: Calm, patient

**Spark** (Creative collaborator)
- **ElevenLabs:** `josh` - Energetic, friendly
- **OpenAI:** `alloy` - Neutral
- Tone: Enthusiastic, upbeat

**Ghost** (Minimal signal)
- **ElevenLabs:** `sam` - Neutral, professional
- **OpenAI:** `echo` - Male
- Tone: Flat, precise

**Atlas** (Systems thinker)
- **ElevenLabs:** `arnold` - Authoritative, measured
- **OpenAI:** `fable` - British male
- Tone: Thoughtful, strategic

### Override Voice

**Per-agent override:**
```json
{
  "agents": {
    "registry": [
      {
        "id": "main",
        "character": "nova",
        "voiceId": "bella"
      }
    ]
  }
}
```

**Global override:**
```json
{
  "voice": {
    "tts": {
      "defaultVoice": "bella"
    }
  }
}
```

## Voice Pipeline

How voice messages flow through the system.

### Incoming Voice Message

```
User sends voice message (Telegram/WhatsApp)
        ↓
VoiceMessagePipeline.processIncoming(audioBuffer)
        ↓
STT Provider (Whisper/Deepgram)
        ↓
Transcribed text
        ↓
Agent processes as text message
        ↓
Agent generates text response
        ↓
(if autoVoiceReply is true)
        ↓
VoiceMessagePipeline.processOutgoing(responseText)
        ↓
TTS Provider (ElevenLabs/OpenAI)
        ↓
Audio buffer
        ↓
Send voice message back to user
```

### Auto Voice Reply

**Enable:**
```json
{
  "voice": {
    "autoVoiceReply": true
  }
}
```

When enabled:
- Voice message → Text response as voice
- Text message → Text response as text

**Disable:**
```json
{
  "voice": {
    "autoVoiceReply": false
  }
}
```

When disabled:
- Voice message → Text response as text
- Agent never sends voice replies

## Configuration

### Full Example

```json
{
  "voice": {
    "tts": {
      "provider": "elevenlabs",
      "apiKey": "${ELEVENLABS_API_KEY}",
      "defaultVoice": "adam",
      "model": "eleven_multilingual_v2",
      "stability": 0.5,
      "similarityBoost": 0.75,
      "outputFormat": "mp3"
    },
    "stt": {
      "provider": "whisper",
      "model": "whisper-1",
      "apiKey": "${OPENAI_API_KEY}"
    },
    "calls": {
      "enabled": false,
      "provider": "twilio",
      "accountSid": "${TWILIO_ACCOUNT_SID}",
      "authToken": "${TWILIO_AUTH_TOKEN}",
      "phoneNumber": "${TWILIO_PHONE_NUMBER}"
    },
    "autoVoiceReply": true
  }
}
```

### Minimal (OpenAI Only)

```json
{
  "voice": {
    "tts": {
      "provider": "openai-tts",
      "apiKey": "${OPENAI_API_KEY}",
      "model": "tts-1"
    },
    "stt": {
      "provider": "whisper",
      "apiKey": "${OPENAI_API_KEY}"
    },
    "autoVoiceReply": true
  }
}
```

Uses OpenAI for both TTS and STT (single API key).

### Disable Voice

```json
{
  "voice": {
    "tts": {
      "provider": "elevenlabs"
    },
    "stt": {
      "provider": "whisper"
    },
    "autoVoiceReply": false
  }
}
```

No API keys configured = voice features disabled.

## Usage

### Telegram Voice

1. Configure voice in `~/.vena/vena.json`
2. Enable Telegram channel
3. Start Vena: `vena start`
4. In Telegram:
   - Record voice message
   - Send to bot
   - Bot transcribes and responds (text or voice)

### WhatsApp Voice

1. Configure voice in `~/.vena/vena.json`
2. Enable WhatsApp channel
3. Start Vena: `vena start`
4. In WhatsApp:
   - Record voice note
   - Send to bot
   - Bot transcribes and responds (text or voice)

### Phone Calls (Coming Soon)

1. Configure Twilio/Vapi
2. Enable calls: `"calls": { "enabled": true }`
3. Start Vena: `vena start`
4. Call your Twilio number
5. Have voice conversation with agent

## Best Practices

### Provider Selection

**For best quality:**
- TTS: ElevenLabs
- STT: Whisper

**For speed:**
- TTS: OpenAI TTS (tts-1)
- STT: Deepgram

**For cost:**
- TTS: OpenAI TTS (tts-1)
- STT: Whisper

**For simplicity (single provider):**
- TTS: OpenAI TTS
- STT: Whisper
- One API key for both

### Voice Selection

1. Use character default voices (they match personalities)
2. Test different voices with `vena chat --character nova`
3. Override per-agent if needed
4. Consider your audience (formal vs casual)

### Performance

**Reduce latency:**
- Use Deepgram for STT (faster than Whisper)
- Use OpenAI TTS with `tts-1` (faster than ElevenLabs)
- Disable voice for text-only channels

**Improve quality:**
- Use ElevenLabs for TTS
- Use Whisper for STT
- Adjust ElevenLabs stability/similarity

### Cost Optimization

**Monitor usage:**
- Check provider dashboards
- Track minutes transcribed/synthesized
- Set up billing alerts

**Optimize:**
- Disable `autoVoiceReply` if not needed
- Use cheaper models (tts-1 vs tts-1-hd)
- Cache TTS responses for common phrases (coming soon)

### Language Support

**Multilingual:**
- ElevenLabs: 29 languages
- Whisper: 99 languages
- OpenAI TTS: English only

**Auto-detect:**
- Whisper automatically detects language
- Agent responds in same language

**Force language:**
Coming soon - configure per agent:
```json
{
  "agents": {
    "registry": [
      {
        "id": "spanish-agent",
        "language": "es"
      }
    ]
  }
}
```

## Testing

### Test TTS

Coming soon:
```bash
vena voice test-tts "Hello, this is a test"
```

Generates audio file and plays it.

### Test STT

Coming soon:
```bash
vena voice test-stt ./audio.mp3
```

Transcribes audio file and prints text.

### Test Voice Pipeline

Send voice message via Telegram or WhatsApp and verify:
1. Message transcribed correctly
2. Agent responds appropriately
3. Response sent as voice (if `autoVoiceReply` enabled)
4. Voice quality is acceptable

## Troubleshooting

### Voice not working

1. Check API keys are configured
2. Verify environment variables are set:
   ```bash
   echo $ELEVENLABS_API_KEY
   echo $OPENAI_API_KEY
   ```
3. Check logs: `vena start 2>&1 | grep -i voice`
4. Test with simpler setup (OpenAI only)

### TTS fails

**ElevenLabs:**
- Check API key is valid
- Verify billing is active
- Check voice ID is correct
- Try different voice

**OpenAI:**
- Check API key is valid
- Verify billing is active
- Try `tts-1` instead of `tts-1-hd`

### STT fails

**Whisper:**
- Check API key is valid
- Verify audio format (mp3, ogg, wav)
- Check file size < 25 MB
- Audio should be < 10 minutes

**Deepgram:**
- Check API key is valid
- Verify credit balance
- Check audio format
- Try different model

### Poor quality

**TTS:**
- Try different voice
- Adjust stability (ElevenLabs)
- Use higher quality model (tts-1-hd)
- Check text for unusual characters

**STT:**
- Ensure audio is clear (no background noise)
- Use higher quality microphone
- Try Deepgram (better with noisy audio)
- Check audio format is supported

### High latency

- Use Deepgram for STT (faster)
- Use OpenAI TTS with `tts-1` (faster)
- Check network connection
- Consider using local Whisper (coming soon)

## Advanced Topics

### Custom Voices (ElevenLabs)

1. Clone your own voice
2. Design custom voice
3. Use in config:
```json
{
  "voice": {
    "tts": {
      "provider": "elevenlabs",
      "defaultVoice": "your-custom-voice-id"
    }
  }
}
```

### Voice Styles (ElevenLabs)

Coming soon - control emotion and style:
```json
{
  "voice": {
    "tts": {
      "provider": "elevenlabs",
      "style": "excited",
      "emotion": 0.8
    }
  }
}
```

### Local Whisper

Coming soon - run Whisper locally:
```json
{
  "voice": {
    "stt": {
      "provider": "whisper-local",
      "model": "base.en"
    }
  }
}
```

Benefits:
- No API costs
- Privacy (data stays local)
- No rate limits

Trade-offs:
- Slower (unless GPU)
- Requires ~1-3 GB disk space

### Voice Caching

Coming soon - cache TTS responses:
```json
{
  "voice": {
    "tts": {
      "cache": {
        "enabled": true,
        "maxSize": 100
      }
    }
  }
}
```

Caches common phrases to reduce API calls.

## Next Steps

- [Channels](./channels.md) - Enable Telegram/WhatsApp for voice
- [Agents](./agents.md) - Configure character voice mapping
- [Configuration](./configuration.md) - Full voice config reference
