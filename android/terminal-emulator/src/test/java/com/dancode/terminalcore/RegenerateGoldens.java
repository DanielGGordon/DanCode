package com.dancode.terminalcore;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;

import com.termux.terminal.TerminalEmulator;

/**
 * Test-only regenerator. Writes the canonical fixture byte streams to
 * {@code src/test/resources/fixtures/<name>.bin} and the matching emulator
 * screen snapshots to {@code src/test/resources/snapshots/<name>.snap}.
 *
 * <p>Run via:
 * <pre>
 *   android/gradlew :terminal-emulator:test --tests com.dancode.terminalcore.RegenerateGoldens -Dregen.goldens=true
 * </pre>
 *
 * The regenerator is gated on the {@code regen.goldens} system property so
 * an accidental {@code gradlew test} invocation never silently rewrites the
 * committed snapshots — it would defeat the whole point of golden tests.
 *
 * <p>This is not annotated as a JUnit test; it's invoked from
 * {@link RegenerateGoldensTest} when the property is set, and exists as a
 * separate plain class to keep the test report clean.
 */
public final class RegenerateGoldens {

    private RegenerateGoldens() {
    }

    static boolean enabled() {
        return "true".equalsIgnoreCase(System.getProperty("regen.goldens"));
    }

    static void run() throws IOException {
        Path resources = locateResourcesDir();
        Path fixturesDir = resources.resolve("fixtures");
        Path snapshotsDir = resources.resolve("snapshots");
        Files.createDirectories(fixturesDir);
        Files.createDirectories(snapshotsDir);

        for (String name : Fixtures.ALL) {
            byte[] bytes = Fixtures.bytesFor(name);
            atomicWrite(fixturesDir.resolve(name + ".bin"), bytes);

            TerminalEmulator emu = EmulatorDriver.newEmulator(Fixtures.COLS, Fixtures.ROWS);
            EmulatorDriver.feed(emu, bytes);
            String snap = ScreenSnapshot.serialize(emu);
            atomicWrite(snapshotsDir.resolve(name + ".snap"), snap.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        }

        // Mid-stream Claude snapshot (alt-screen + mouse-tracking enabled).
        byte[] claude = Fixtures.bytesFor(Fixtures.CLAUDE_ALT_SCREEN);
        TerminalEmulator emu = EmulatorDriver.newEmulator(Fixtures.COLS, Fixtures.ROWS);
        EmulatorDriver.feed(emu, java.util.Arrays.copyOf(claude, Fixtures.CLAUDE_MID_STREAM_OFFSET));
        String midSnap = ScreenSnapshot.serialize(emu);
        atomicWrite(snapshotsDir.resolve(Fixtures.CLAUDE_ALT_SCREEN + "-midstream.snap"),
                midSnap.getBytes(java.nio.charset.StandardCharsets.UTF_8));
    }

    private static void atomicWrite(Path target, byte[] content) throws IOException {
        Path tmp = target.resolveSibling(target.getFileName().toString() + ".tmp");
        Files.write(tmp, content);
        Files.move(tmp, target, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
    }

    /**
     * Find the {@code src/test/resources} dir relative to the running test's
     * working directory. Gradle invokes test JVMs with cwd set to the module
     * root, so a simple resolve works.
     */
    private static Path locateResourcesDir() {
        Path here = Paths.get("").toAbsolutePath();
        // If invoked from the repo root, descend into the module path.
        Path direct = here.resolve("src/test/resources");
        if (Files.isDirectory(direct.getParent().getParent())) return direct;
        Path nested = here.resolve("android/terminal-emulator/src/test/resources");
        return nested;
    }
}
