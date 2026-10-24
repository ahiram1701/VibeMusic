import numpy as np

from engine import Audio, prompt_wave


def test_prompt_wave_mono_model_mixes_down_and_resamples() -> None:
    stereo = Audio(samples=np.stack([np.ones(100), -np.ones(100) * 0.5]), sample_rate=100)
    wave = prompt_wave(stereo, 200, channels=1)
    assert wave.shape == (200,)
    assert wave.dtype == np.float32
    assert np.allclose(wave, 0.25)


def test_prompt_wave_stereo_model_gets_two_channels() -> None:
    # El fragmento de partida llega en mono: un modelo estéreo necesita (2, muestras),
    # no un vector plano (que se leería como "N canales").
    mono = Audio(samples=np.linspace(-1, 1, 160).reshape(1, -1), sample_rate=160)
    wave = prompt_wave(mono, 320, channels=2)
    assert wave.shape == (2, 320)
    assert np.array_equal(wave[0], wave[1])

    stereo = Audio(samples=np.stack([np.zeros(50), np.ones(50)]), sample_rate=50)
    both = prompt_wave(stereo, 50, channels=2)
    assert both.shape == (2, 50)
    assert both[0].max() == 0 and both[1].min() == 1


def test_prompt_wave_accepts_1d_samples() -> None:
    flat = Audio(samples=np.zeros(10), sample_rate=10)
    assert prompt_wave(flat, 10, channels=2).shape == (2, 10)
    assert prompt_wave(flat, 10, channels=1).shape == (10,)
