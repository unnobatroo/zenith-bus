cmake_minimum_required(VERSION 3.22)
project(zenith_bus VERSION 0.1.0 LANGUAGES CXX)

add_library(zenith INTERFACE)
add_library(zenith::zenith ALIAS zenith)
target_include_directories(zenith INTERFACE
    $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
    $<INSTALL_INTERFACE:include>)
target_compile_features(zenith INTERFACE cxx_std_20)

# Warning policy applied to everything built in this repo (not propagated to
# consumers of the header-only library).
add_library(zenith_warnings INTERFACE)
target_compile_options(zenith_warnings INTERFACE -Wall -Wextra -Wpedantic -Werror)

option(ZENITH_BUILD_TESTS "Build unit tests" OFF)
option(ZENITH_BUILD_EXAMPLES "Build examples" ${PROJECT_IS_TOP_LEVEL})
option(ZENITH_BUILD_BENCHMARKS "Build benchmarks" OFF)

include(FetchContent)

if(ZENITH_BUILD_TESTS)
    FetchContent_Declare(googletest
        URL https://github.com/google/googletest/archive/refs/tags/v1.14.0.tar.gz)
    FetchContent_Declare(fmt
        URL https://github.com/fmtlib/fmt/archive/refs/tags/10.2.1.tar.gz)
    FetchContent_MakeAvailable(googletest fmt)
    enable_testing()
    add_subdirectory(tests)
endif()

if(ZENITH_BUILD_EXAMPLES)
    FetchContent_Declare(CLI11
        URL https://github.com/CLIUtils/CLI11/archive/refs/tags/v2.4.1.tar.gz)
    if(NOT TARGET fmt::fmt)
        FetchContent_Declare(fmt
            URL https://github.com/fmtlib/fmt/archive/refs/tags/10.2.1.tar.gz)
    endif()
    FetchContent_MakeAvailable(CLI11 fmt)
    add_subdirectory(examples)
endif()

if(ZENITH_BUILD_BENCHMARKS)
    FetchContent_Declare(benchmark
        URL https://github.com/google/benchmark/archive/refs/tags/v1.8.3.tar.gz)
    set(BENCHMARK_ENABLE_TESTING OFF CACHE BOOL "" FORCE)
    FetchContent_MakeAvailable(benchmark)
    add_subdirectory(benchmarks)
endif()
