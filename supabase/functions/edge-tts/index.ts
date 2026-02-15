import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Microsoft Edge TTS voices mapped by language code
const EDGE_TTS_VOICES: Record<string, string> = {
  af: "af-ZA-AdriNeural",
  am: "am-ET-AmehaNeural",
  ar: "ar-SA-HamedNeural",
  az: "az-AZ-BabekNeural",
  bg: "bg-BG-BorislavNeural",
  bn: "bn-BD-NabanitaNeural",
  bs: "bs-BA-GoranNeural",
  ca: "ca-ES-EnricNeural",
  cs: "cs-CZ-AntoninNeural",
  cy: "cy-GB-AledNeural",
  da: "da-DK-ChristelNeural",
  de: "de-DE-ConradNeural",
  el: "el-GR-AthinaNeural",
  es: "es-ES-AlvaroNeural",
  et: "et-EE-AnuNeural",
  fa: "fa-IR-DilaraNeural",
  fi: "fi-FI-HarriNeural",
  fil: "fil-PH-AngeloNeural",
  fr: "fr-FR-DeniseNeural",
  ga: "ga-IE-ColmNeural",
  gl: "gl-ES-RoiNeural",
  gu: "gu-IN-DhwaniNeural",
  ha: "ha-NG-SarkinNeural",
  he: "he-IL-AvriNeural",
  hi: "hi-IN-MadhurNeural",
  hr: "hr-HR-GabrijelaNeural",
  hu: "hu-HU-NoemiNeural",
  hy: "hy-AM-AnahitNeural",
  id: "id-ID-ArdiNeural",
  ig: "ig-NG-AbeoNeural",
  is: "is-IS-GunnarNeural",
  it: "it-IT-DiegoNeural",
  ja: "ja-JP-KeitaNeural",
  jv: "jv-ID-DimasNeural",
  ka: "ka-GE-GiorgiNeural",
  kk: "kk-KZ-AigulNeural",
  km: "km-KH-PisethNeural",
  kn: "kn-IN-GaganNeural",
  ko: "ko-KR-InJoonNeural",
  lo: "lo-LA-ChanthavongNeural",
  lt: "lt-LT-LeonasNeural",
  lv: "lv-LV-EveritaNeural",
  mk: "mk-MK-AleksandarNeural",
  ml: "ml-IN-MidhunNeural",
  mn: "mn-MN-BataaNeural",
  mr: "mr-IN-AarohiNeural",
  ms: "ms-MY-OsmanNeural",
  mt: "mt-MT-GraceNeural",
  my: "my-MM-NilarNeural",
  nb: "nb-NO-FinnNeural",
  ne: "ne-NP-HemkalaNeural",
  nl: "nl-NL-ColetteNeural",
  no: "nb-NO-FinnNeural",
  or: "or-IN-SubhasiniNeural",
  pa: "pa-IN-OjasNeural",
  pl: "pl-PL-MarekNeural",
  ps: "ps-AF-LatifaNeural",
  pt: "pt-BR-AntonioNeural",
  ro: "ro-RO-AlinaNeural",
  ru: "ru-RU-DmitryNeural",
  si: "si-LK-SameeraNeural",
  sk: "sk-SK-LukasNeural",
  sl: "sl-SI-PetraNeural",
  so: "so-SO-MuuseNeural",
  sq: "sq-AL-AnilaNeural",
  sr: "sr-RS-NicholasNeural",
  su: "su-ID-JajangNeural",
  sv: "sv-SE-MattiasNeural",
  sw: "sw-KE-RafikiNeural",
  ta: "ta-IN-ValluvarNeural",
  te: "te-IN-MohanNeural",
  th: "th-TH-NiwatNeural",
  tl: "fil-PH-AngeloNeural",
  tr: "tr-TR-AhmetNeural",
  uk: "uk-UA-OstapNeural",
  ur: "ur-PK-AsadNeural",
  uz: "uz-UZ-MadinaNeural",
  vi: "vi-VN-HoaiMyNeural",
  yo: "yo-NG-SadeNeural",
  zh: "zh-CN-XiaoxiaoNeural",
  "zh-TW": "zh-TW-HsiaoChenNeural",
  zu: "zu-ZA-ThandoNeural",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { text, languageCode = "en" } = await req.json();
    if (!text) throw new Error("Text is required");

    const voice = EDGE_TTS_VOICES[languageCode];
    if (!voice) {
      throw new Error(`Voice not available for language: ${languageCode}. Listen feature works for English and Auto Detect only for this language.`);
    }

    const truncatedText = String(text).slice(0, 2000);

    // Use edge-tts via a public TTS API
    // We'll use the free Streamlabs Polly / edge-tts API approach
    // Actually, let's use a simple SSML approach with Azure's free endpoint
    const SSML = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${languageCode}'><voice name='${voice}'>${escapeXml(truncatedText)}</voice></speak>`;

    const ttsResponse = await fetch(
      "https://eastus.api.cognitive.microsoft.com/sts/v1.0/issuetoken",
      { method: "POST", headers: { "Content-Length": "0" } }
    );

    // Fallback: Use a free Edge TTS proxy service
    // Since direct Azure requires a key, we'll use the tts.quest free API or similar
    const proxyUrl = `https://api.tts.quest/v1/edge-tts?text=${encodeURIComponent(truncatedText)}&voice=${encodeURIComponent(voice)}`;
    
    const audioResponse = await fetch(proxyUrl);
    
    if (!audioResponse.ok) {
      // Fallback to a different free edge-tts service
      const fallbackUrl = `https://tts.langeek.co/READ_TEXT/${encodeURIComponent(truncatedText)}/${voice}`;
      const fallbackResponse = await fetch(fallbackUrl);
      
      if (!fallbackResponse.ok) {
        throw new Error(`Edge TTS failed for language ${languageCode}`);
      }
      
      const audioBuffer = await fallbackResponse.arrayBuffer();
      return new Response(audioBuffer, {
        headers: { ...corsHeaders, "Content-Type": "audio/mpeg" },
      });
    }

    const data = await audioResponse.json();
    if (data.url) {
      // Fetch the actual audio file
      const audioFileResponse = await fetch(data.url);
      const audioBuffer = await audioFileResponse.arrayBuffer();
      return new Response(audioBuffer, {
        headers: { ...corsHeaders, "Content-Type": "audio/mpeg" },
      });
    }

    throw new Error("Edge TTS did not return audio");
  } catch (error) {
    console.error("Edge TTS error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
