import React, { useMemo, useState } from 'react';
import { Mic, Search, Volume2, FileText, RefreshCw, Play, Copy, Check } from 'lucide-react';
import { z } from 'zod';

// ===== Utilities =====
const isUrl = (s) => /^https?:\/\/\S+$/i.test(String(s || '').trim());
const hashKey = async (str) => {
  const buf = new TextEncoder().encode(str);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
};

// Radio read speed ~2.5–3.0 wps → word targets for timing
const WORD_TARGETS = {
  long: { min: 60, max: 75 },
  medium: { min: 30, max: 40 },
  short: { min: 18, max: 28 },
};

// Strict schema for LLM output
const ScriptSchema = z.object({
  storyDetails: z.string().min(1),
  songAnalysis: z.string().min(1),
  whyThisWorks: z.string().min(1),
  scripts: z.array(z.object({
    script: z.string().min(1),
    deliveryNotes: z.string().min(1),
  })).length(3),
});

const baseScriptStyles = [
  { id: 'conversational', name: 'Conversational', description: 'Natural, friendly, relatable' },
  { id: 'humorous', name: 'Humorous', description: 'Light, witty, entertaining' },
  { id: 'touching', name: 'Touching', description: 'Emotional, heartfelt, moving' },
  { id: 'inspiring', name: 'Inspiring', description: 'Uplifting, motivational' },
  { id: 'dramatic', name: 'Dramatic', description: 'Bold, impactful storytelling' },
  { id: 'reflective', name: 'Reflective', description: 'Thoughtful, contemplative' },
];

const DJScriptGenerator = () => {
  const [storyInput, setStoryInput] = useState('');
  const [songTitle, setSongTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [selectedStyle, setSelectedStyle] = useState('conversational');
  const [pgSafe, setPgSafe] = useState(true);
  const [scripts, setScripts] = useState([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [currentListeningField, setCurrentListeningField] = useState('');
  const [storyDetails, setStoryDetails] = useState('');
  const [songAnalysis, setSongAnalysis] = useState('');
  const [whyThisWorks, setWhyThisWorks] = useState('');
  const [micTestResult, setMicTestResult] = useState('');
  const [showPersonalStyleModal, setShowPersonalStyleModal] = useState(false);
  const [personalStyle, setPersonalStyle] = useState(null);
  const [styleDescription, setStyleDescription] = useState('');
  const [uploadedScripts, setUploadedScripts] = useState([]);
  const [uploadedAudio, setUploadedAudio] = useState([]);
  const [copiedIndex, setCopiedIndex] = useState(-1);

  const scriptStyles = personalStyle
    ? [...baseScriptStyles, { id: 'personal', name: 'My Personal Style', description: personalStyle.description || 'Your unique DJ voice' }]
    : baseScriptStyles;

  // ====== A) File uploads via FileReader ======
  const handleFileUpload = (event, type) => {
    const files = Array.from(event.target.files || []);
    files.forEach(file => {
      if (type === 'script') {
        // Keep it simple: .txt only on client; parse docx/pdf server-side if you add it later.
        const reader = new FileReader();
        reader.onload = () => {
          setUploadedScripts(prev => [...prev, { name: file.name, content: String(reader.result || '') }]);
        };
        reader.readAsText(file);
      } else if (type === 'audio') {
        // Retain the Blob for server upload later
        setUploadedAudio(prev => [...prev, { name: file.name, blob: file }]);
      }
    });
  };

  const createPersonalStyle = async () => {
    if (!styleDescription.trim()) {
      alert('Please provide a description of your style');
      return;
    }
    if (uploadedScripts.length === 0) {
      alert('Please upload at least one .txt script sample');
      return;
    }
    try {
      const scriptSamples = uploadedScripts.map(s => s.content).join('\n\n---\n\n');
      const personalStylePrompt = `Analyze these script samples from a radio DJ to create a personalized style profile:

USER'S STYLE DESCRIPTION: "${styleDescription}"

SCRIPT SAMPLES:
${scriptSamples}

Respond with JSON:
{
  "styleProfile": "Detailed analysis of the DJ's writing style, voice, and approach",
  "keyCharacteristics": ["list", "of", "specific", "style", "traits"],
  "samplePhrases": ["example phrases", "that capture their voice"],
  "instructions": "Specific guidance for replicating this style in new scripts"
}`;

      // Call server for Anthropic (B)
const resp = await fetch('/api/complete-json', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ mode: 'script', prompt: comprehensivePrompt })
});
if (!resp.ok) {
  const text = await resp.text();
  throw new Error(`API ${resp.status}: ${text.slice(0, 200)}`);
}
const { data } = await resp.json();

setStoryDetails(data.storyDetails);
setSongAnalysis(data.songAnalysis);
setScripts(data.scripts);
      const clean = String(completion || '').trim().replace(/^```json\s*/i, '').replace(/\s*```$/,'');
      const styleData = JSON.parse(clean);

      const newPersonalStyle = {
        description: styleDescription,
        profile: styleData,
        scripts: uploadedScripts,
        audio: uploadedAudio,
        createdAt: new Date().toISOString(),
      };
      setPersonalStyle(newPersonalStyle);
      setShowPersonalStyleModal(false);
      setSelectedStyle('personal');
      alert('Personal style created successfully! You can now use it to generate scripts.');
    } catch (e) {
      console.error(e);
      alert('Error creating personal style. Please try again.');
    }
  };

  const clearPersonalStyle = () => {
    setPersonalStyle(null);
    setUploadedScripts([]);
    setUploadedAudio([]);
    setStyleDescription('');
    if (selectedStyle === 'personal') setSelectedStyle('conversational');
  };

  // ====== E) Mic/speech hardening ======
  const testMicrophone = async () => {
    try {
      try {
        const permissionStatus = await navigator.permissions?.query?.({ name: 'microphone' });
        if (permissionStatus?.state === 'denied') {
          setMicTestResult('❌ Microphone permission is denied. Check site permissions in your browser settings.');
          return;
        }
      } catch { /* ignore */ }
      const stream = await navigator.mediaDevices?.getUserMedia?.({ audio: true });
      if (!stream) throw new Error('getUserMedia unavailable');
      setMicTestResult('✅ Microphone access granted! Voice input should work now.');
      stream.getTracks().forEach(t => t.stop());
    } catch (error) {
      let msg = `❌ Error: ${error.name || 'Unknown'} - ${error.message || String(error)}`;
      setMicTestResult(msg);
    }
  };

  const startListening = (field) => {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      alert('Speech recognition not supported in this browser. Try Chrome, Edge, or Safari.');
      return;
    }
    const recognition = new Recognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';
    recognition.maxAlternatives = 1;
    setIsListening(true);
    setCurrentListeningField(field);

    recognition.onresult = (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript || '';
      if (field === 'story') {
        setStoryInput(transcript);
      } else if (field === 'song') {
        const parts = transcript.toLowerCase().split(' by ');
        if (parts.length === 2) {
          setSongTitle(parts[0].trim());
          setArtist(parts[1].trim());
        } else {
          setSongTitle(transcript);
        }
      }
    };
    recognition.onend = () => { setIsListening(false); setCurrentListeningField(''); };
    recognition.onerror = (event) => {
      setIsListening(false); setCurrentListeningField('');
      alert(`Speech recognition error: ${event.error || 'unknown'}`);
    };
    try { recognition.start(); } catch { setIsListening(false); setCurrentListeningField(''); }
  };

  // ====== B, D, F) Generate scripts with URL extract, schema validation, timing constraints ======
  const generateScripts = async () => {
    if (!storyInput.trim() || !songTitle.trim() || !artist.trim()) {
      alert('Please fill in all fields');
      return;
    }

    setIsGenerating(true);
    setScripts([]);
    setWhyThisWorks('');
    setStoryDetails('');
    setSongAnalysis('');

    try {
      // Cache key (nice-to-have)
      const styleBlob = selectedStyle === 'personal' && personalStyle
        ? JSON.stringify(personalStyle.profile)
        : selectedStyle;
      let cleanedStory = storyInput.trim();

      if (isUrl(cleanedStory)) {
        const r = await fetch('/api/extract', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: cleanedStory }),
        });
        const { text } = await r.json();
        cleanedStory = (text || '').slice(0, 8000); // guardrail
      }

      const cacheInput = JSON.stringify({
        cleanedStory,
        songTitle,
        artist,
        styleBlob,
        pgSafe,
      });
      const key = await hashKey(cacheInput);
      const cached = localStorage.getItem(`qs_${key}`);
      if (cached) {
        const parsed = JSON.parse(cached);
        setStoryDetails(parsed.storyDetails);
        setSongAnalysis(parsed.songAnalysis);
        setWhyThisWorks(parsed.whyThisWorks);
        setScripts(parsed.scripts);
        setIsGenerating(false);
        return;
      }

      let styleInstructions = '';
      if (selectedStyle === 'personal' && personalStyle) {
        const p = personalStyle.profile;
        styleInstructions = `
PERSONAL STYLE PROFILE: ${p.styleProfile}
KEY CHARACTERISTICS: ${(p.keyCharacteristics || []).join(', ')}
SAMPLE PHRASES: ${(p.samplePhrases || []).join(', ')}
REPLICATION INSTRUCTIONS: ${p.instructions}
Use this personal style to match the DJ's unique voice, word choices, rhythm, and approach.`;
      } else {
        styleInstructions = `Write in a ${selectedStyle} style.`;
      }

      const safety = pgSafe ? `
Content safety: Keep humor clean (PG-safe). Avoid profanity or sensitive topics unless directly provided in input.` : '';

      const timingHint = `
Timing & word-count targets (approx):
- Script 1 (long): ${WORD_TARGETS.long.min}-${WORD_TARGETS.long.max} words
- Script 2 (medium): ${WORD_TARGETS.medium.min}-${WORD_TARGETS.medium.max} words
- Script 3 (short): ${WORD_TARGETS.short.min}-${WORD_TARGETS.short.max} words`;

      const comprehensivePrompt = `You are helping a radio DJ create compelling transition scripts that connect a story to a song.

STORY INPUT (CLEANED TEXT): "${cleanedStory}"
SONG: "${songTitle}" by ${artist}
SCRIPT STYLE: ${selectedStyle}
${styleInstructions}
${safety}

Do the following, in order:
1) Create a brief radio-friendly summary of the story (assume it's current/trending; <= 120 words).
2) Analyze the general themes and emotional core of "${songTitle}" by ${artist} without quoting lyrics beyond 10 words.
3) Propose the best single bridging angle that logically links the story to the song for mainstream radio.
4) Generate 3 different transition scripts that connect the story to the song, each matching the specified tone and the word-length targets below. End each with a clean handoff into the song without naming the DJ.
${timingHint}

Return ONLY strict JSON in this format:
{
  "storyDetails": "brief summary",
  "songAnalysis": "themes/emotions",
  "whyThisWorks": "one-sentence rationale PDs would appreciate",
  "scripts": [
    { "script": "first script (long)", "deliveryNotes": "timing/delivery guidance" },
    { "script": "second script (medium)", "deliveryNotes": "timing/delivery guidance" },
    { "script": "third script (short)", "deliveryNotes": "timing/delivery guidance" }
  ]
}`;

      const resp = await fetch('/api/complete-json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: comprehensivePrompt }),
      });
      const { completion, error } = await resp.json();
      if (error) throw new Error(error);

      const cleanResponse = String(completion || '').trim().replace(/^```json\s*/i, '').replace(/\s*```$/,'');
      const parsedRaw = JSON.parse(cleanResponse);
      const parsed = ScriptSchema.safeParse(parsedRaw);
      if (!parsed.success) throw new Error('Model returned invalid JSON');

      const data = parsed.data;

      setStoryDetails(data.storyDetails);
      setSongAnalysis(data.songAnalysis);
      setWhyThisWorks(data.whyThisWorks);
      setScripts(data.scripts);

      localStorage.setItem(`qs_${key}`, JSON.stringify(data));
    } catch (error) {
      console.error('Error generating scripts:', error);
      alert(`Error generating scripts: ${error.message}. Please try again.`);
    } finally {
      setIsGenerating(false);
    }
  };

  const regenerateScripts = () => generateScripts();

  const [justCopied, setJustCopied] = useState(false);
  const copyToClipboard = async (text, index) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIndex(index);
      setJustCopied(true);
      setTimeout(() => { setJustCopied(false); setCopiedIndex(-1); }, 1200);
    } catch {
      alert('Copy failed. Select the text and copy manually.');
    }
  };

  const headerHint = useMemo(() => (
    pgSafe ? 'PG-safe on' : 'PG-safe off'
  ), [pgSafe]);

  return (
    <div className="max-w-4xl mx-auto p-6 bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900 min-h-screen">
      <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-8 shadow-2xl">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-3 mb-2">
            <Mic className="w-8 h-8 text-yellow-400" />
            <h1 className="text-3xl font-bold text-white">QuipSync</h1>
          </div>
          <p className="text-gray-300">Create compelling transitions that connect trending stories with your music • <span className="text-yellow-300">{headerHint}</span></p>
        </div>

        <div className="grid md:grid-cols-2 gap-6 mb-8">
          <div className="bg-white/10 rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
              <Search className="w-5 h-5" />
              Trending Story (URL or Text)
            </h2>
            <div className="space-y-4">
              <div className="relative">
                <textarea
                  value={storyInput}
                  onChange={(e) => setStoryInput(e.target.value)}
                  placeholder="Paste a URL (we'll fetch & clean it) or type/paste the story text"
                  className="w-full h-32 px-4 py-3 bg-white/20 border border-white/30 rounded-lg text-white placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-yellow-400"
                />
                <button
                  onClick={() => startListening('story')}
                  disabled={isListening}
                  className={`absolute top-3 right-3 p-2 rounded-full ${
                    isListening && currentListeningField === 'story'
                      ? 'bg-red-500 animate-pulse'
                      : 'bg-yellow-500 hover:bg-yellow-600'
                  } transition-colors`}
                >
                  <Mic className="w-4 h-4 text-white" />
                </button>
              </div>
              {storyDetails && (
                <div className="bg-green-500/20 border border-green-500/30 rounded-lg p-3">
                  <p className="text-sm text-green-100 font-medium">Story Research:</p>
                  <p className="text-sm text-green-200 mt-1">{storyDetails}</p>
                </div>
              )}
            </div>
          </div>

          <div className="bg-white/10 rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
              <Play className="w-5 h-5" />
              Next Song
            </h2>
            <div className="space-y-4">
              <div className="relative">
                <input
                  type="text"
                  value={songTitle}
                  onChange={(e) => setSongTitle(e.target.value)}
                  placeholder="Song title"
                  className="w-full px-4 py-3 bg-white/20 border border-white/30 rounded-lg text-white placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-yellow-400"
                />
              </div>
              <div className="relative">
                <input
                  type="text"
                  value={artist}
                  onChange={(e) => setArtist(e.target.value)}
                  placeholder="Artist"
                  className="w-full px-4 py-3 bg-white/20 border border-white/30 rounded-lg text-white placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-yellow-400"
                />
                <button
                  onClick={() => startListening('song')}
                  disabled={isListening}
                  className={`absolute top-3 right-3 p-2 rounded-full ${
                    isListening && currentListeningField === 'song'
                      ? 'bg-red-500 animate-pulse'
                      : 'bg-yellow-500 hover:bg-yellow-600'
                  } transition-colors`}
                >
                  <Mic className="w-4 h-4 text-white" />
                </button>
              </div>
              <p className="text-sm text-gray-300">💡 Tip: Say "Song Title by Artist Name" for voice input</p>
              {songAnalysis && (
                <div className="bg-blue-500/20 border border-blue-500/30 rounded-lg p-3">
                  <p className="text-sm text-blue-100 font-medium">Song Analysis:</p>
                  <p className="text-sm text-blue-200 mt-1">{songAnalysis}</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Style + PG Toggle */}
        <div className="bg-white/10 rounded-xl p-6 mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-white flex items-center gap-2">
              <FileText className="w-5 h-5" />
              Script Style
            </h2>
            <label className="flex items-center gap-2 text-sm text-gray-200">
              <input
                type="checkbox"
                checked={pgSafe}
                onChange={(e) => setPgSafe(e.target.checked)}
              />
              PG-safe
            </label>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {scriptStyles.map((style) => (
              <button
                key={style.id}
                onClick={() => setSelectedStyle(style.id)}
                className={`p-4 rounded-lg border transition-all ${
                  selectedStyle === style.id
                    ? 'bg-yellow-500 border-yellow-400 text-white'
                    : 'bg-white/10 border-white/30 text-gray-300 hover:bg-white/20'
                }`}
              >
                <div className="font-medium">{style.name}</div>
                <div className="text-sm opacity-80">{style.description}</div>
              </button>
            ))}
            <button
              onClick={() => setShowPersonalStyleModal(true)}
              className="p-4 rounded-lg border border-dashed border-yellow-400/50 text-yellow-400 hover:bg-yellow-400/10 transition-all"
            >
              <div className="font-medium">+ Create Personal Style</div>
              <div className="text-sm opacity-80">Upload your scripts</div>
            </button>
          </div>
          {personalStyle && (
            <div className="mt-4 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-yellow-400 font-medium">Personal Style Active</p>
                  <p className="text-sm text-yellow-300">{personalStyle.description}</p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowPersonalStyleModal(true)}
                    className="text-sm bg-yellow-500 hover:bg-yellow-600 text-white px-3 py-1 rounded"
                  >
                    Edit
                  </button>
                  <button
                    onClick={clearPersonalStyle}
                    className="text-sm bg-red-500 hover:bg-red-600 text-white px-3 py-1 rounded"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Generate */}
        <div className="text-center mb-8">
          <button
            onClick={generateScripts}
            disabled={isGenerating}
            className="bg-gradient-to-r from-yellow-500 to-orange-500 hover:from-yellow-600 hover:to-orange-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-4 px-8 rounded-full text-lg transition-all transform hover:scale-105 shadow-lg"
          >
            {isGenerating ? (
              <span className="flex items-center gap-2">
                <RefreshCw className="w-5 h-5 animate-spin" />
                Generating Scripts...
              </span>
            ) : (
              'Generate Scripts'
            )}
          </button>
        </div>

        {/* Results */}
        {(scripts.length > 0) && (
          <div className="bg-white/10 rounded-xl p-6 mb-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-semibold text-white flex items-center gap-2">
                <FileText className="w-5 h-5" />
                Generated Scripts ({selectedStyle})
              </h2>
              <button
                onClick={regenerateScripts}
                className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                Regenerate
              </button>
            </div>

            {whyThisWorks && (
              <div className="bg-emerald-500/20 border border-emerald-500/30 rounded-lg p-3 mb-4">
                <p className="text-sm text-emerald-100 font-medium">Why this works:</p>
                <p className="text-sm text-emerald-200 mt-1">{whyThisWorks}</p>
              </div>
            )}

            <div className="space-y-6">
              {scripts.map((s, index) => (
                <div key={index} className="bg-white/10 rounded-lg p-5 border border-white/20">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold text-yellow-400">Script Option {index + 1}</h3>
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-gray-300">
                        {index === 0 ? '~20–25s' : index === 1 ? '~10–15s' : '~5–10s'}
                      </span>
                      <button
                        onClick={() => copyToClipboard(s.script, index)}
                        className="text-xs bg-white/20 hover:bg-white/30 text-white px-2 py-1 rounded flex items-center gap-1"
                      >
                        {copiedIndex === index ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                        {copiedIndex === index ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                  </div>
                  <div className="bg-black/30 rounded-lg p-4 mb-3">
                    <p className="text-white leading-relaxed font-mono text-sm whitespace-pre-wrap">
                      {s.script}
                    </p>
                  </div>
                  <div className="bg-blue-500/20 rounded-lg p-3">
                    <p className="text-sm text-blue-100 font-medium">Delivery Notes:</p>
                    <p className="text-sm text-blue-200 mt-1">{s.deliveryNotes}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Mic Test */}
        <div className="bg-white/10 rounded-xl p-6">
          <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
            <Mic className="w-5 h-5" />
            Microphone Test
          </h2>
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <button
                onClick={testMicrophone}
                className="bg-green-500 hover:bg-green-600 text-white px-6 py-3 rounded-lg flex items-center gap-2 transition-colors"
              >
                <Mic className="w-4 h-4" />
                Test Microphone Access
              </button>
              <button
                onClick={() => {
                  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
                  if (Recognition) {
                    const recognition = new Recognition();
                    recognition.continuous = false;
                    recognition.interimResults = false;
                    recognition.lang = 'en-US';
                    recognition.onstart = () => setMicTestResult('🎤 Speech recognition started - say something!');
                    recognition.onresult = (event) => {
                      const transcript = event.results?.[0]?.[0]?.transcript || '';
                      setMicTestResult(`✅ Success! Heard: "${transcript}"`);
                    };
                    recognition.onerror = (event) => setMicTestResult(`❌ Speech error: ${event.error || 'unknown'}`);
                    recognition.start();
                  } else {
                    setMicTestResult('❌ Speech recognition not supported');
                  }
                }}
                className="bg-blue-500 hover:bg-blue-600 text-white px-6 py-3 rounded-lg flex items-center gap-2 transition-colors"
              >
                <Volume2 className="w-4 h-4" />
                Test Speech Recognition
              </button>
            </div>
            {micTestResult && (
              <div className={`p-3 rounded-lg ${
                /✅|🎤/.test(micTestResult) ? 'bg-green-500/20 border border-green-500/30' : 'bg-red-500/20 border border-red-500/30'
              }`}>
                <p className="text-sm text-white whitespace-pre-line">{micTestResult}</p>
              </div>
            )}
            <div className="text-sm text-gray-300">
              <p><strong>Chrome Instructions:</strong></p>
              <p>1) Try "Test Speech Recognition" first</p>
              <p>2) If that fails, run "Test Microphone Access" for detailed errors</p>
              <p>3) Use the microphone icon in the address bar to manage permissions</p>
              <p>4) Ensure "Microphone" is set to "Allow" for this site</p>
            </div>
          </div>
        </div>

        {/* Personal Style Modal */}
        {showPersonalStyleModal && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl p-8 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
              <h2 className="text-2xl font-bold text-gray-800 mb-6">
                {personalStyle ? 'Edit Personal Style' : 'Create Personal Style'}
              </h2>

              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Style Description</label>
                  <textarea
                    value={styleDescription}
                    onChange={(e) => setStyleDescription(e.target.value)}
                    placeholder="Describe your unique DJ style…"
                    className="w-full h-24 px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-400"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Upload Script Samples (.txt)</label>
                  <input
                    type="file"
                    multiple
                    accept=".txt"
                    onChange={(e) => handleFileUpload(e, 'script')}
                    className="w-full p-3 border border-gray-300 rounded-lg"
                  />
                  {uploadedScripts.length > 0 && (
                    <div className="mt-2">
                      <p className="text-sm font-medium text-gray-700">Uploaded Scripts:</p>
                      <ul className="text-sm text-gray-600">
                        {uploadedScripts.map((script, index) => (<li key={index}>• {script.name}</li>))}
                      </ul>
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Upload Audio Samples (Optional)</label>
                  <input
                    type="file"
                    multiple
                    accept=".mp3,.wav,.m4a"
                    onChange={(e) => handleFileUpload(e, 'audio')}
                    className="w-full p-3 border border-gray-300 rounded-lg"
                  />
                  {uploadedAudio.length > 0 && (
                    <div className="mt-2">
                      <p className="text-sm font-medium text-gray-700">Uploaded Audio:</p>
                      <ul className="text-sm text-gray-600">
                        {uploadedAudio.map((audio, index) => (<li key={index}>• {audio.name}</li>))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex gap-4 mt-8">
                <button
                  onClick={createPersonalStyle}
                  className="bg-yellow-500 hover:bg-yellow-600 text-white px-6 py-3 rounded-lg font-medium"
                >
                  {personalStyle ? 'Update Style' : 'Create Style'}
                </button>
                <button
                  onClick={() => setShowPersonalStyleModal(false)}
                  className="bg-gray-300 hover:bg-gray-400 text-gray-800 px-6 py-3 rounded-lg font-medium"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {isListening && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl p-8 text-center">
              <div className="w-16 h-16 bg-red-500 rounded-full flex items-center justify-center mx-auto mb-4 animate-pulse">
                <Mic className="w-8 h-8 text-white" />
              </div>
              <h3 className="text-xl font-bold text-gray-800 mb-2">Listening...</h3>
              <p className="text-gray-600">
                {currentListeningField === 'story' ? 'Describe the trending story' : 'Say the song title and artist'}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default DJScriptGenerator;


