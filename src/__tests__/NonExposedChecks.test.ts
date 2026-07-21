import Statsig, { StatsigUser } from '../index';
import StatsigInstanceUtils from '../StatsigInstanceUtils';
import StatsigTestUtils from './StatsigTestUtils';

jest.mock('node-fetch', () => jest.fn());

const CONFIG_SPEC_RESPONSE = JSON.stringify(
  require('./data/exposure_logging_dcs.json'),
);

const NON_EXPOSED_CHECKS_EVENT = 'statsig::non_exposed_checks';
const MAX_BUFFER_SIZE = 10;

const user: StatsigUser = {
  userID: 'a-user',
};

describe('NonExposedChecks', () => {
  let events: {
    eventName: string;
    metadata: { checks?: Record<string, number> };
  }[] = [];

  const nonExposedChecksEvents = () =>
    events.filter((e) => e.eventName === NON_EXPOSED_CHECKS_EVENT);

  beforeEach(async () => {
    const fetch = require('node-fetch');
    fetch.mockImplementation((url: string, params) => {
      if (url.includes('download_config_specs')) {
        return Promise.resolve({
          ok: true,
          text: () => Promise.resolve(CONFIG_SPEC_RESPONSE),
        });
      }

      if (url.includes('log_event')) {
        const posted = JSON.parse(params.body)['events'];
        // Record on a macrotask so events are only visible after a flush
        // that actually awaited the POST
        return new Promise((resolve) => {
          setImmediate(() => {
            events = events.concat(posted);
            resolve({ ok: true });
          });
        });
      }

      return Promise.resolve({
        ok: true,
        text: () => Promise.resolve('{}'),
      });
    });

    events = [];

    StatsigInstanceUtils.setInstance(null);
    await Statsig.initialize('secret-key', {
      disableDiagnostics: true,
      loggingMaxBufferSize: MAX_BUFFER_SIZE,
    });
  });

  it('delivers all events when appending checks fills the buffer', async () => {
    Statsig.checkGateWithExposureLoggingDisabledSync(user, 'a_gate');
    for (let i = 0; i < MAX_BUFFER_SIZE - 1; i++) {
      Statsig.logEvent(user, `event_${i}`);
    }

    await StatsigTestUtils.getLogger().flush();

    expect(events).toHaveLength(MAX_BUFFER_SIZE);
    expect(nonExposedChecksEvents()).toHaveLength(1);
  });

  it('flushes a single event with check counts and resets', async () => {
    Statsig.checkGateWithExposureLoggingDisabledSync(user, 'a_gate');
    Statsig.checkGateWithExposureLoggingDisabledSync(user, 'a_gate');
    Statsig.getConfigWithExposureLoggingDisabledSync(user, 'a_config');

    await Statsig.flush();

    const checkEvents = nonExposedChecksEvents();
    expect(checkEvents).toHaveLength(1);
    expect(checkEvents[0].metadata.checks).toEqual({
      a_gate: 2,
      a_config: 1,
    });

    events = [];
    await Statsig.flush();
    expect(events).toHaveLength(0);
  });
});
