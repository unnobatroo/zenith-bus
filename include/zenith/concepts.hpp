// Copyright (C) 2026 Jaloliddin Ismailov
// SPDX-License-Identifier: GPL-3.0-or-later

#pragma once

#include <type_traits>

namespace zenith {

// Payloads must be safe to copy with memcpy semantics so the queue never
// needs per-slot constructors or destructors on the hot path.
template <typename T>
concept TriviallyRelocatable = std::is_trivially_copyable_v<T> && std::is_standard_layout_v<T>;

} // namespace zenith
