"""Keep import-time private paths and worker managers scoped to a test fixture."""
import sys


def isolate_research_service(test_case):
    previous = sys.modules.pop("local_service", None)

    def restore():
        loaded = sys.modules.pop("local_service", None)
        if loaded is not None and loaded is not previous:
            loaded.job_manager.executor.shutdown(wait=True, cancel_futures=True)
        if previous is not None:
            sys.modules["local_service"] = previous

    test_case.addClassCleanup(restore)
