/**
 * Astraz Voice - Natural Speech Intent Detection
 * Inspects real-time transcribed speech across multiple languages to check if the user
 * wants to terminate/end the ongoing session.
 */
export function detectTerminationIntent(text: string): boolean {
  if (!text) return false;
  
  // Clean punctuation and normalize text to lowercase
  const normalized = text
    .toLowerCase()
    .trim()
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g, "");

  // Broad patterns for "end the call / session" in all supported languages
  const patterns = [
    // English: "end the call", "terminate the session", "hang up", "bye bye astraz", "stop talking", "exit session"
    /\b(end (the )?call|terminate (the )?session|hang up|close (the )?session|stop (the |this )?(call|conversation)|good( )?bye|bye( )?bye|exit (the |this )?session|disconnect( the session)?|terminate|disconnect|hangup)\b/i,
    
    // Spanish: "terminar la llamada", "colgar", "finalizar", "adios astraz"
    /\b(terminar (la )?llamada|colgar( la llamada)?|finalizar( la)? sesion|terminar sesion|adios|hasta luego|salir de la llamada)\b/i,
    
    // French: "terminer l'appel", "raccrocher", "fin de session", "au revoir"
    /\b(terminer l( )?appel|couper l( )?appel|raccrocher|fin de la session|arreter l( )?appel|au revoir|salut)\b/i,
    
    // German: "anruf beenden", "auflegen", "tschuss"
    /\b(anruf beenden|sitzung beenden|auflegen|gesprahc beenden|tschuss|auf wiedersehen)\b/i,
    
    // Chinese: "结束通话", "挂断电话", "再见", "拜拜"
    /(结束通话|挂断电话|关闭会话|再见|拜拜)/i,
    
    // Japanese: "通話を終了", "電話を切る", "さようなら"
    /(通話を終了|電話を切る|セッションを終了|さようなら|バイバイ)/i,
    
    // Hausa: "gama kiran", "kashe kiran", "sai an jima" 
    /\b(gama kiran|kashe kiran|kawo karshen kiran|gama zaman|sai an jima|kashe|gama)\b/i,

    // Yoruba: "gbe kuro", "pa kiran", "oda bo", "odabo"
    /\b(gbe kuro|pa kiran|oda bo|odabo|dabọ|dabo)\b/i,

    // Igbo: "mechie oku", "kwụsị kiran", "ka ọ dị", "kachifọ", "nọrọ nke ọma"
    /\b(mechie oku|kwụsị|kwusi|kachifọ|kachifo|ka ọ dị|ka o di|mechie|kwusi)\b/i
  ];

  return patterns.some(pattern => pattern.test(normalized));
}
