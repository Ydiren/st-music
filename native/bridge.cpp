#include "AtariAudioRenderer.h"
#include <emscripten/emscripten.h>

namespace {
AtariAudioRenderer* renderer = nullptr;
int currentSubtune = 0;
int16_t samples[2048];
}

extern "C" {
EMSCRIPTEN_KEEPALIVE void unload_song() {
    AtariAudioRenderer::Destroy(renderer);
    renderer = nullptr;
    currentSubtune = 0;
}

EMSCRIPTEN_KEEPALIVE int load_song(const void* data, unsigned size, unsigned rate) {
    unload_song();
    renderer = AtariAudioRenderer::Create(data, size, rate);
    if (!renderer) return 0;
    if (!renderer->InitSubSong(renderer->GetSongInfo().defaultSubsong)) {
        unload_song();
        return 0;
    }
    currentSubtune = renderer->GetSongInfo().defaultSubsong;
    return 1;
}

EMSCRIPTEN_KEEPALIVE int select_subtune(int subtune) {
    if (!renderer || subtune < 1 || subtune > renderer->GetSongInfo().subsongCount) return 0;
    if (!renderer->InitSubSong(subtune)) return 0;
    currentSubtune = subtune;
    return 1;
}

EMSCRIPTEN_KEEPALIVE int reset_song() {
    return select_subtune(currentSubtune);
}

EMSCRIPTEN_KEEPALIVE const int16_t* render_audio(unsigned count) {
    if (!renderer || count > 2048) return nullptr;
    renderer->AudioRender(samples, count);
    return samples;
}

EMSCRIPTEN_KEEPALIVE const char* song_title() { return renderer ? renderer->GetSongInfo().musicName : ""; }
EMSCRIPTEN_KEEPALIVE const char* song_author() { return renderer ? renderer->GetSongInfo().musicAuthor : ""; }
EMSCRIPTEN_KEEPALIVE const char* song_year() { return renderer ? renderer->GetSongInfo().year : ""; }
EMSCRIPTEN_KEEPALIVE int subtune_count() { return renderer ? renderer->GetSongInfo().subsongCount : 0; }
EMSCRIPTEN_KEEPALIVE int default_subtune() { return renderer ? renderer->GetSongInfo().defaultSubsong : 0; }
}
