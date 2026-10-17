#include <vector>
#include <cmath>

bool func0(std::vector<float> v, float threshold) {
    for (size_t i = 1; i < v.size(); ++i) {
        if (std::abs(v[i] - v[i - 1]) > threshold) {
            return true;
        }
    }
    return false;
}
int main(){return 0;}
