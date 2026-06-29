package com.dancode.android.net

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.w3c.dom.Element
import org.w3c.dom.Node
import org.w3c.dom.NodeList
import java.io.File
import javax.xml.parsers.DocumentBuilderFactory

/**
 * Acceptance criterion 2: "the app's `network-security-config` pins that
 * self-signed cert for the host and rejects any other certificate; a test
 * asserts the pinning configuration is present and scoped to the host."
 *
 * This test reads the resource XML directly from the source tree and
 * asserts:
 *   - the file exists at the conventional location
 *   - exactly one <domain-config> declares <domain>5.78.231.51</domain>
 *   - that domain-config contains a non-empty <pin-set>
 *   - the <pin> uses SHA-256 and is a real base64 hash (not a placeholder)
 *   - cleartextTrafficPermitted is explicitly false for the pinned host
 *   - the AndroidManifest wires `networkSecurityConfig="@xml/network_security_config"`
 */
class NetworkSecurityConfigTest {

    private val configFile = File("src/main/res/xml/network_security_config.xml")
    private val manifestFile = File("src/main/AndroidManifest.xml")

    @Test
    fun config_file_exists_at_conventional_location() {
        assertTrue(
            "Expected network_security_config.xml at ${configFile.absolutePath}",
            configFile.exists(),
        )
    }

    @Test
    fun domain_config_scopes_pinning_to_the_dancode_ip() {
        val pinnedDomainConfig = findPinnedDomainConfig()
        val domainNodes = pinnedDomainConfig.getElementsByTagName("domain")
        val pinnedDomains = (0 until domainNodes.length).map {
            (domainNodes.item(it) as Element).textContent.trim()
        }
        assertEquals(
            "Expected exactly one <domain> entry scoping the pin to 5.78.231.51",
            listOf("5.78.231.51"),
            pinnedDomains,
        )
        // includeSubdomains must be explicit so the pin doesn't accidentally
        // cover the wrong host if someone adds a subdomain later.
        val includeSubdomains = (domainNodes.item(0) as Element)
            .getAttribute("includeSubdomains")
        assertEquals("false", includeSubdomains)
    }

    @Test
    fun pin_set_is_non_empty_and_uses_real_sha256_digests() {
        val pinnedDomainConfig = findPinnedDomainConfig()
        val pinSets = pinnedDomainConfig.getElementsByTagName("pin-set")
        assertTrue("Expected a <pin-set>", pinSets.length >= 1)
        val pinSet = pinSets.item(0) as Element
        val pins = pinSet.getElementsByTagName("pin")
        assertTrue("Expected at least one <pin>", pins.length >= 1)

        for (i in 0 until pins.length) {
            val pin = pins.item(i) as Element
            assertEquals("SHA-256", pin.getAttribute("digest"))
            val value = pin.textContent.trim()
            assertTrue(
                "Pin must be a base64 SHA-256 (32 bytes = 44 chars with padding), " +
                    "got '$value'",
                value.length == 44 && value.endsWith("="),
            )
            assertTrue(
                "Pin must not be a placeholder",
                value != "BASE64_HASH_HERE" && value != "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
            )
        }
    }

    @Test
    fun pinned_host_forbids_cleartext_traffic() {
        val pinnedDomainConfig = findPinnedDomainConfig()
        val cleartext = pinnedDomainConfig.getAttribute("cleartextTrafficPermitted")
        // Default for domain-config is "true" — the pinning block MUST set
        // it explicitly so an unauthenticated HTTP fallback never happens
        // for the pinned host.
        assertEquals("false", cleartext)
    }

    @Test
    fun base_config_forbids_cleartext_globally() {
        val root = parseXml(configFile)
        val baseConfigs = root.getElementsByTagName("base-config")
        assertTrue("Expected a <base-config>", baseConfigs.length >= 1)
        val baseConfig = baseConfigs.item(0) as Element
        assertEquals("false", baseConfig.getAttribute("cleartextTrafficPermitted"))
    }

    @Test
    fun android_manifest_references_the_network_security_config() {
        val manifestText = manifestFile.readText()
        assertTrue(
            "Manifest must wire android:networkSecurityConfig=\"@xml/network_security_config\"",
            manifestText.contains("android:networkSecurityConfig=\"@xml/network_security_config\""),
        )
    }

    private fun findPinnedDomainConfig(): Element {
        val root = parseXml(configFile)
        val configs = root.getElementsByTagName("domain-config")
        val match = (0 until configs.length).mapNotNull { idx ->
            val element = configs.item(idx) as Element
            val domains = element.getElementsByTagName("domain")
            val hasIp = (0 until domains.length).any { d ->
                (domains.item(d) as Element).textContent.trim() == "5.78.231.51"
            }
            if (hasIp) element else null
        }.singleOrNull()
        assertNotNull(
            "Expected exactly one <domain-config> declaring <domain>5.78.231.51</domain>",
            match,
        )
        return match!!
    }

    private fun parseXml(file: File): Element {
        val factory = DocumentBuilderFactory.newInstance().apply { isNamespaceAware = false }
        val doc = factory.newDocumentBuilder().parse(file)
        return doc.documentElement
    }

    @Suppress("unused")
    private fun NodeList.asList(): List<Node> =
        (0 until length).map { item(it) }
}
