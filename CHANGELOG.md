# Change Log

## 1.1.1 Oct 7, 2025
Improved code docs.

## 1.1.0 Oct 7, 2025
AES Encryption was using timestamp for the IV value, exposing the time the encryption occured (and potentially the internal key value).  IV is now random.

## 1.0.5 Oct 7, 2025
Initial release