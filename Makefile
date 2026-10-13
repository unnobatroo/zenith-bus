# Convenience targets — everything is plain cmake/ctest/npm-free underneath.
.PHONY: build test bench viz wasm asan tsan clean

build:
	cmake -B build -DZENITH_BUILD_TESTS=ON -DZENITH_BUILD_BENCHMARKS=ON -DZENITH_BUILD_EXAMPLES=ON
	cmake --build build -j

test: build
	ctest --test-dir build --output-on-failure

# Benchmarks need Release — an unoptimized build measures nothing real.
build-release:
	cmake -B build-release -DCMAKE_BUILD_TYPE=Release \
		-DZENITH_BUILD_BENCHMARKS=ON
	cmake --build build-release -j

bench: build-release
	./build-release/benchmarks/bench_event_bus --benchmark_min_time=1s

# Real concurrent ping-pong + throughput only
bench-rt: build-release
	./build-release/benchmarks/bench_event_bus --benchmark_filter='PingPong|InterThread'

# No build step — pure static files. Needs python3 only.
viz:
	python3 web/serve.py

wasm:
	bash wasm/build.sh

asan:
	cmake -B build-asan -DZENITH_BUILD_TESTS=ON -DCMAKE_CXX_FLAGS="-fsanitize=address,undefined"
	cmake --build build-asan -j && ctest --test-dir build-asan --output-on-failure

tsan:
	cmake -B build-tsan -DZENITH_BUILD_TESTS=ON -DCMAKE_CXX_FLAGS="-fsanitize=thread"
	cmake --build build-tsan -j && ctest --test-dir build-tsan --output-on-failure

clean:
	rm -rf build build-asan build-tsan
