# systemd-in-Docker container used by the Phase 10 integration test.
# Builds a minimal Debian image with systemd as PID 1, a dancode user with
# linger pre-enabled, Node.js, and node-pty build dependencies.
#
# Run with:
#   docker run -d --privileged --tmpfs /tmp --tmpfs /run --tmpfs /run/lock \
#              -v /sys/fs/cgroup:/sys/fs/cgroup:rw --cgroupns=host \
#              -v /path/to/DanCode:/opt/dancode \
#              dancode-systemd-it
#
# The host-side runner script in `run.sh` wraps that incantation and exec's
# the test script (`run-in-container.sh`) as the `dancode` user.
FROM debian:12-slim

ENV container=docker
ENV DEBIAN_FRONTEND=noninteractive
ENV NODE_VERSION=20.x

RUN apt-get update && apt-get install -y --no-install-recommends \
        systemd systemd-sysv dbus dbus-user-session \
        ca-certificates curl gnupg procps \
        build-essential python3 \
        sudo \
    && rm -rf /var/lib/apt/lists/* \
    && rm -f /lib/systemd/system/multi-user.target.wants/* \
       /etc/systemd/system/*.wants/* \
       /lib/systemd/system/local-fs.target.wants/* \
       /lib/systemd/system/sockets.target.wants/*udev* \
       /lib/systemd/system/sockets.target.wants/*initctl* \
       /lib/systemd/system/basic.target.wants/* \
       /lib/systemd/system/anaconda.target.wants/*

# Install Node.js 20 from NodeSource.
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# Create a non-root user so the test runs `systemctl --user` as that user.
# Pre-enable linger so `systemd --user` is alive before any login.
RUN useradd -m -s /bin/bash -G sudo dancode \
    && echo 'dancode ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/dancode \
    && mkdir -p /var/lib/systemd/linger \
    && touch /var/lib/systemd/linger/dancode

STOPSIGNAL SIGRTMIN+3
CMD ["/sbin/init"]
