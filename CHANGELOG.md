# Change Log

## 1.2.0 Oct 8, 2025
Implemented new `timeRangeToBytes` function designed to assist with database range queries.
Added SQLite based tests and standard tests for new range query feature.
Added SQLite examples to readme for range query feature.

## 1.1.3 Oct 7, 2025
Added Go port to README.md
BREAKING: Updated `encryptedId` to be `encryptedFactory`, copying the API tweak from the go port.

## 1.1.2 Oct 7, 2025
Added dash in hex enconding.

## 1.1.1 Oct 7, 2025
Improved code docs.

## 1.1.0 Oct 7, 2025
AES Encryption was using timestamp for the IV value, exposing the time the encryption occured (and potentially the internal key value).  IV is now random.

## 1.0.5 Oct 7, 2025
Initial release