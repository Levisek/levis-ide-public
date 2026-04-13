<?php
// LevisIDE — CAPTCHA token pro feedback formulář
ini_set('session.cookie_httponly', '1');
ini_set('session.cookie_secure', '1');
ini_set('session.cookie_samesite', 'None');
ini_set('session.use_only_cookies', '1');
session_start();

header('Content-Type: application/json; charset=UTF-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-API-Key');
header('Access-Control-Allow-Credentials: true');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$token = bin2hex(random_bytes(32));
$_SESSION['captcha_token'] = $token;
echo json_encode(['token' => $token]);
