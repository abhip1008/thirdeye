// Metro defines __DEV__; a bare Node test environment does not.
// False, so the logger stays quiet and test output shows only failures.
global.__DEV__ = false;
