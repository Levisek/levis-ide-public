<?php
// LevisIDE Feedback endpoint — levinger.cz (Wedos)
// Zabezpečení: API klíč + honeypot + CAPTCHA token + rate limit (GRAL standard)

ini_set('session.cookie_httponly', '1');
ini_set('session.cookie_secure', '1');
ini_set('session.cookie_samesite', 'None');
ini_set('session.use_only_cookies', '1');
session_start();

header('Content-Type: application/json; charset=UTF-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-API-Key');
header('Access-Control-Allow-Credentials: true');

// ── Config ──
$API_KEY = 'lvsIDE-fb-k7x9Q2mW4pR8';
$to      = 'martin@levinger.cz';

// Preflight
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'POST only']);
    exit;
}

// ── API klíč ──
$key = $_SERVER['HTTP_X_API_KEY'] ?? '';
if ($key !== $API_KEY) {
    http_response_code(403);
    echo json_encode(['error' => 'Forbidden']);
    exit;
}

// ── Input ──
$raw = file_get_contents('php://input');
$input = json_decode($raw, true);
if (json_last_error() !== JSON_ERROR_NONE || !$input) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid JSON']);
    exit;
}

// ── Honeypot (skryté pole, bot ho vyplní) ──
if (!empty($input['phone'])) {
    // Tiše OK — bot si myslí že prošlo
    echo json_encode(['ok' => true]);
    exit;
}

// ── CAPTCHA token ──
$captcha = $input['captcha'] ?? '';
if (empty($captcha) || $captcha !== ($_SESSION['captcha_token'] ?? '')) {
    http_response_code(403);
    echo json_encode(['error' => 'Invalid captcha']);
    exit;
}
unset($_SESSION['captcha_token']);

// ── Validace ──
if (empty($input['title'])) {
    http_response_code(400);
    echo json_encode(['error' => 'Missing title']);
    exit;
}

// ── Rate limit (max 5 req / IP / hodina, file locking) ──
$ip = preg_replace('/[^a-f0-9.:_]/', '', $_SERVER['REMOTE_ADDR'] ?? 'unknown');
$lockFile = __DIR__ . '/.feedback-rate/limits.json';
$dir = dirname($lockFile);
if (!is_dir($dir)) mkdir($dir, 0700, true);

$fp = fopen($lockFile, 'c+');
if ($fp && flock($fp, LOCK_EX)) {
    $raw = stream_get_contents($fp);
    $entries = $raw ? json_decode($raw, true) : [];
    if (!is_array($entries)) $entries = [];

    $now = time();
    // Vyčistit staré záznamy
    foreach ($entries as $k => $timestamps) {
        $filtered = [];
        foreach ($timestamps as $t) {
            if ($t > $now - 3600) $filtered[] = $t;
        }
        if (empty($filtered)) { unset($entries[$k]); } else { $entries[$k] = $filtered; }
    }

    $ipHits = isset($entries[$ip]) ? $entries[$ip] : [];
    if (count($ipHits) >= 5) {
        flock($fp, LOCK_UN); fclose($fp);
        http_response_code(429);
        echo json_encode(['error' => 'Too many requests']);
        exit;
    }

    $ipHits[] = $now;
    $entries[$ip] = array_values($ipHits);
    ftruncate($fp, 0); rewind($fp);
    fwrite($fp, json_encode($entries));
    flock($fp, LOCK_UN);
}
if ($fp) fclose($fp);

// ── Sanitizace & délka ──
$type  = htmlspecialchars(substr($input['type'] ?? 'bug', 0, 50), ENT_QUOTES, 'UTF-8');
$title = htmlspecialchars(substr($input['title'] ?? '', 0, 200), ENT_QUOTES, 'UTF-8');
$desc  = htmlspecialchars(substr($input['desc'] ?? '', 0, 5000), ENT_QUOTES, 'UTF-8');

// ── Mail ──
$subject = '=?UTF-8?B?' . base64_encode("LevisIDE [$type] $title") . '?=';

$body  = "Typ: $type\n";
$body .= "Název: $title\n\n";
$body .= "Popis:\n$desc\n";
$body .= "\n---\nOdesláno z LevisIDE feedback formuláře";
$body .= "\nIP: $ip";

$headers  = "From: noreply@levinger.cz\r\n";
$headers .= "Reply-To: $to\r\n";
$headers .= "Content-Type: text/plain; charset=UTF-8\r\n";

$sent = @mail($to, $subject, $body, $headers);

echo json_encode($sent ? ['ok' => true] : ['error' => 'Mail failed']);
if (!$sent) http_response_code(500);
