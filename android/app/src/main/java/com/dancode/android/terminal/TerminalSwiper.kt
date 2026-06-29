package com.dancode.android.terminal

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag

object TerminalSwiperTags {
    const val PAGER = "terminal-swiper-pager"
}

/**
 * HorizontalPager wrapper that lets the user swipe between the project's
 * sibling terminals (acceptance criterion 1). The caller supplies a
 * per-page slot so live and stub renderings can share the same swipe
 * machinery — production wires `page` to [TerminalHost]; tests pass a
 * lightweight placeholder.
 */
@Composable
fun TerminalSwiper(
    terminals: List<TerminalSummary>,
    initialIndex: Int,
    page: @Composable (TerminalSummary) -> Unit,
) {
    val safeIndex = initialIndex.coerceIn(0, (terminals.size - 1).coerceAtLeast(0))
    val pagerState = rememberPagerState(
        initialPage = safeIndex,
        pageCount = { terminals.size },
    )
    HorizontalPager(
        state = pagerState,
        modifier = Modifier
            .fillMaxSize()
            .testTag(TerminalSwiperTags.PAGER),
    ) { index ->
        page(terminals[index])
    }
}
