package com.dancode.terminalcore;

import org.junit.Assume;
import org.junit.Test;

/**
 * Test wrapper that runs {@link RegenerateGoldens} only when the
 * {@code regen.goldens=true} system property is set. Without the property
 * the test is skipped via JUnit Assume so a normal {@code gradlew test}
 * never rewrites the committed fixtures.
 */
public class RegenerateGoldensTest {

    @Test
    public void regenerateWhenRequested() throws Exception {
        Assume.assumeTrue(
                "Skipping golden regeneration (set -Dregen.goldens=true to enable)",
                RegenerateGoldens.enabled());
        RegenerateGoldens.run();
    }
}
