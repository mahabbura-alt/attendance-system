package com.omos.fuel.data

import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec

/**
 * Buka aplikasi dengan PIN saat offline (maks. N hari sejak sinkron, keputusan Q5).
 * Hash PBKDF2 dibuat dari PIN yang terbukti benar saat login ONLINE; server tidak pernah mengirim hash.
 * Disimpan di EncryptedSharedPreferences per petugas.
 */
object OfflinePin {
    private const val ITERATIONS = 120_000
    private const val KEY_BITS = 256

    fun newSalt(): String = ByteArray(16).also { SecureRandom().nextBytes(it) }.let { Base64.getEncoder().encodeToString(it) }

    fun hash(pin: String, salt: String): String {
        val spec = PBEKeySpec(pin.toCharArray(), Base64.getDecoder().decode(salt), ITERATIONS, KEY_BITS)
        val key = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded
        spec.clearPassword()
        return Base64.getEncoder().encodeToString(key)
    }

    fun verify(pin: String, salt: String, expected: String): Boolean =
        MessageDigest.isEqual(hash(pin, salt).toByteArray(), expected.toByteArray())

    fun validFormat(pin: String): Boolean = pin.length == 6 && pin.all { it.isDigit() }

    /** Sama dengan isTrivialPin backend: semua sama atau berurutan naik/turun. */
    fun isTrivial(pin: String): Boolean {
        if (!validFormat(pin)) return true
        if (pin.all { it == pin[0] }) return true
        return "01234567890123".contains(pin) || "98765432109876".contains(pin)
    }
}
